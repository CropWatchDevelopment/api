import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type FetchLike = typeof fetch;

export const TTI_REGIONS = ['as1', 'au1', 'eu1', 'nam1'] as const;
export type TtiRegion = (typeof TTI_REGIONS)[number];

/** LoRaWAN settings a new device is created with (a cw_network_profiles row). */
export interface TtiDeviceProfile {
  region: TtiRegion;
  applicationId: string;
  frequencyPlanId: string;
  lorawanVersion: string;
  lorawanPhyVersion: string;
  supportsClassC: boolean;
}

export interface TtiDeviceRef {
  applicationId: string;
  deviceId: string;
}

export interface CreateOtaaInput {
  profile: TtiDeviceProfile;
  deviceId: string;
  devEui: string;
  joinEui: string;
  appKey: string;
}

/** What an existing registration looks like, for deciding whether to adopt it. */
export interface TtiDeviceState {
  /** Cluster whose Join Server holds the device; null when it is not one we know. */
  region: TtiRegion | null;
  /** The AppKey on the Join Server (upper-case hex), or null when none is readable. */
  appKey: string | null;
  /** Registered on the Join, Network and Application Server of its cluster. */
  complete: boolean;
}

/**
 * Why a TTI call failed, in terms the setup flow can act on:
 *  - unavailable: network error, timeout, 5xx, 429 or a transient conflict
 *  - eui_taken:   another device already uses this DevEUI/JoinEUI
 *  - id_taken:    the device ID already exists in the application
 *  - invalid:     TTI rejected the request (bad keys, unknown frequency plan)
 *  - forbidden:   the provisioning key lacks rights on the application
 *  - not_found:   no such device (or application)
 *  - not_configured: the API has no provisioning settings for this region
 */
export type TtiProvisioningErrorKind =
  | 'unavailable'
  | 'eui_taken'
  | 'id_taken'
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'not_configured';

export class TtiProvisioningError extends Error {
  constructor(
    public readonly kind: TtiProvisioningErrorKind,
    message: string,
    public readonly status: number | null = null,
    /** TTI's error name, e.g. `end_device_euis_taken` (never contains keys). */
    public readonly ttiName: string | null = null,
  ) {
    super(message);
    this.name = 'TtiProvisioningError';
  }
}

interface TtiSettings {
  identityBaseUrl: string;
  clusterBaseUrls: Partial<Record<TtiRegion, string>>;
  apiKey: string;
  timeoutMs: number;
}

interface RequestOptions {
  body?: unknown;
  /** Overall deadline for the operation this request belongs to. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const SEARCH_CONCURRENCY = 4;
/** Attempts for idempotent requests (GET/PUT/DELETE). POST is never retried. */
const MAX_ATTEMPTS = 2;
const HEX32 = /^[0-9A-F]{32}$/;

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

/** `as1=https://x.as1…,au1=https://x.au1…` → { as1: …, au1: … }. */
export function parseClusterBaseUrls(
  raw: string | undefined,
): Partial<Record<TtiRegion, string>> {
  const result: Partial<Record<TtiRegion, string>> = {};
  for (const entry of (raw ?? '').split(',')) {
    const [key, ...rest] = entry.split('=');
    const region = key?.trim() as TtiRegion;
    const url = rest.join('=').trim();
    if (TTI_REGIONS.includes(region) && url) {
      result[region] = trimSlash(url);
    }
  }
  return result;
}

/** TTI's error name from `{ details: [{ name }] }`. Its message text is not kept. */
async function readTtiErrorName(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as {
      details?: { name?: unknown }[];
    };
    const name = payload.details?.find(
      (detail) => typeof detail?.name === 'string',
    )?.name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

function classify(
  status: number,
  ttiName: string | null,
): TtiProvisioningErrorKind {
  const name = ttiName ?? '';
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 409) {
    if (/euis_taken/.test(name)) return 'eui_taken';
    if (/id_taken|already_exists/.test(name)) return 'id_taken';
    return 'unavailable';
  }
  if (status === 429 || status >= 500) return 'unavailable';
  return 'invalid';
}

/**
 * Registers OTAA end devices in The Things Industries.
 *
 * The Identity Server (registry, search) is one tenant-wide host; the Join,
 * Network and Application Servers live on the cluster of the device's region.
 * AppKeys only ever travel in Join Server request/response bodies — they are
 * never logged, and error logs carry TTI's error name, not its message.
 */
@Injectable()
export class TtiProvisioningService {
  private readonly logger = new Logger(TtiProvisioningService.name);
  /** Replaced in tests. */
  fetchFn: FetchLike = (input, init) => fetch(input, init);

  constructor(private readonly configService: ConfigService) {}

  private settings(): TtiSettings {
    const identityBaseUrl = trimSlash(
      this.configService.get<string>('PRIVATE_TTI_IDENTITY_BASE_URL')?.trim() ??
        '',
    );
    const apiKey =
      this.configService
        .get<string>('PRIVATE_TTI_PROVISIONING_API_KEY')
        ?.trim() ?? '';
    if (!identityBaseUrl || !apiKey) {
      throw new TtiProvisioningError(
        'not_configured',
        'TTI provisioning is not configured',
      );
    }
    const timeout = Number(
      this.configService.get<string>('PRIVATE_TTI_REQUEST_TIMEOUT_MS'),
    );
    return {
      identityBaseUrl,
      clusterBaseUrls: parseClusterBaseUrls(
        this.configService.get<string>('PRIVATE_TTI_CLUSTER_BASE_URLS'),
      ),
      apiKey,
      timeoutMs:
        Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    };
  }

  private clusterUrl(settings: TtiSettings, region: TtiRegion): string {
    const url = settings.clusterBaseUrls[region];
    if (!url) {
      throw new TtiProvisioningError(
        'not_configured',
        `No TTI cluster configured for region ${region}`,
      );
    }
    return url;
  }

  /** The region whose cluster serves `host` (e.g. a device's join_server_address). */
  private regionForHost(
    settings: TtiSettings,
    host: string | undefined,
  ): TtiRegion | null {
    const wanted = (host ?? '').split(':')[0].toLowerCase();
    if (!wanted) return null;
    for (const region of TTI_REGIONS) {
      const url = settings.clusterBaseUrls[region];
      if (url && new URL(url).hostname.toLowerCase() === wanted) return region;
    }
    return null;
  }

  /**
   * One TTI request. Idempotent requests are retried once on network errors,
   * timeouts, 5xx and transient conflicts (never on 429, never past the
   * deadline); POST is sent exactly once.
   */
  private async request<T>(
    settings: TtiSettings,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    step: string,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const attempts = method === 'POST' ? 1 : MAX_ATTEMPTS;
    let lastError: TtiProvisioningError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (options.signal?.aborted) {
        throw new TtiProvisioningError(
          'unavailable',
          `TTI ${step}: deadline exceeded`,
        );
      }
      const timeout = AbortSignal.timeout(settings.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method,
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            ...(options.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
          signal: options.signal
            ? AbortSignal.any([timeout, options.signal])
            : timeout,
        });
      } catch {
        lastError = new TtiProvisioningError(
          'unavailable',
          `TTI ${step}: no response`,
        );
        await this.backoff(attempt, attempts);
        continue;
      }

      if (response.ok) {
        const text = await response.text();
        try {
          return text ? (JSON.parse(text) as T) : null;
        } catch {
          throw new TtiProvisioningError(
            'unavailable',
            `TTI ${step}: unreadable response`,
            response.status,
          );
        }
      }

      const name = await readTtiErrorName(response);
      const kind = classify(response.status, name);
      lastError = new TtiProvisioningError(
        kind,
        `TTI ${step} failed (${response.status}${name ? ` ${name}` : ''})`,
        response.status,
        name,
      );
      if (kind !== 'not_found') {
        this.logger.warn(lastError.message);
      }
      if (kind !== 'unavailable' || response.status === 429) break;
      await this.backoff(attempt, attempts);
    }
    throw (
      lastError ?? new TtiProvisioningError('unavailable', `TTI ${step} failed`)
    );
  }

  private async backoff(attempt: number, attempts: number): Promise<void> {
    if (attempt >= attempts) return;
    const delay = 300 * attempt + Math.random() * 300;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private deviceUrl(base: string, server: string, ref: TtiDeviceRef): string {
    const app = encodeURIComponent(ref.applicationId);
    const dev = encodeURIComponent(ref.deviceId);
    return `${base}/api/v3/${server ? `${server}/` : ''}applications/${app}/devices/${dev}`;
  }

  /** A GET that answers null when the device is not registered there. */
  private async getOrNull<T>(
    settings: TtiSettings,
    url: string,
    step: string,
    signal?: AbortSignal,
  ): Promise<T | null> {
    try {
      return await this.request<T>(settings, 'GET', url, step, { signal });
    } catch (error) {
      if (error instanceof TtiProvisioningError && error.kind === 'not_found') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Finds the device registered with this DevEUI in any of `applicationIds`
   * (searched in parallel, a few at a time). Null when none has it. An
   * application the key cannot read is skipped, but if none can be read the
   * search fails instead of reporting "not found".
   */
  async findDeviceByDevEui(
    devEui: string,
    applicationIds: string[],
    signal?: AbortSignal,
  ): Promise<TtiDeviceRef | null> {
    const settings = this.settings();
    const apps = [...new Set(applicationIds.filter(Boolean))];
    const target = devEui.toUpperCase();
    let unreadable = 0;

    for (let i = 0; i < apps.length; i += SEARCH_CONCURRENCY) {
      const batch = apps.slice(i, i + SEARCH_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (applicationId) => {
          const url = new URL(
            `/api/v3/search/applications/${encodeURIComponent(applicationId)}/devices`,
            settings.identityBaseUrl,
          );
          url.searchParams.set('dev_eui_contains', target);
          url.searchParams.set('field_mask', 'name');
          url.searchParams.set('limit', '10');
          try {
            const payload = await this.request<{
              end_devices?: {
                ids?: { device_id?: string; dev_eui?: string };
              }[];
            }>(settings, 'GET', url.toString(), 'search', { signal });
            const match = payload?.end_devices?.find(
              (device) => device.ids?.dev_eui?.toUpperCase() === target,
            );
            return match?.ids?.device_id
              ? { applicationId, deviceId: match.ids.device_id }
              : null;
          } catch (error) {
            if (
              error instanceof TtiProvisioningError &&
              (error.kind === 'forbidden' || error.kind === 'not_found')
            ) {
              unreadable += 1;
              return null;
            }
            throw error;
          }
        }),
      );
      const found = results.find((result) => result !== null);
      if (found) return found;
    }

    if (apps.length > 0 && unreadable === apps.length) {
      throw new TtiProvisioningError(
        'forbidden',
        'TTI search: the provisioning key cannot read any application',
      );
    }
    return null;
  }

  /**
   * Reads where an existing registration lives, whether the Join Server has a
   * readable AppKey for it, and whether it is set up on all cluster servers.
   */
  async inspectDevice(
    ref: TtiDeviceRef,
    signal?: AbortSignal,
  ): Promise<TtiDeviceState> {
    const settings = this.settings();
    const identity = await this.getOrNull<{ join_server_address?: string }>(
      settings,
      `${this.deviceUrl(settings.identityBaseUrl, '', ref)}?field_mask=join_server_address`,
      'identity get',
      signal,
    );
    const region = this.regionForHost(settings, identity?.join_server_address);
    if (!identity || !region) {
      return { region: null, appKey: null, complete: false };
    }

    const cluster = this.clusterUrl(settings, region);
    const [js, ns, as] = await Promise.all([
      this.getOrNull<{ root_keys?: { app_key?: { key?: string } } }>(
        settings,
        `${this.deviceUrl(cluster, 'js', ref)}?field_mask=root_keys.app_key.key`,
        'join server get',
        signal,
      ),
      this.getOrNull(
        settings,
        `${this.deviceUrl(cluster, 'ns', ref)}?field_mask=frequency_plan_id`,
        'network server get',
        signal,
      ),
      this.getOrNull(
        settings,
        `${this.deviceUrl(cluster, 'as', ref)}?field_mask=formatters`,
        'application server get',
        signal,
      ),
    ]);
    const appKey = js?.root_keys?.app_key?.key?.toUpperCase() ?? null;
    return {
      region,
      appKey: appKey && HEX32.test(appKey) ? appKey : null,
      complete: Boolean(js && ns && as),
    };
  }

  /**
   * Creates an OTAA device: Identity Server, then Join, Network and
   * Application Server. If anything fails the device is removed again, so no
   * half-registered device is left behind. An ID already present in the
   * application for this same DevEUI is an unfinished earlier attempt: it is
   * completed rather than refused.
   */
  async createOtaaDevice(
    input: CreateOtaaInput,
    signal?: AbortSignal,
  ): Promise<TtiDeviceRef> {
    const settings = this.settings();
    const { profile, deviceId } = input;
    const cluster = this.clusterUrl(settings, profile.region);
    const clusterHost = new URL(cluster).hostname;
    const ref = { applicationId: profile.applicationId, deviceId };
    const devEui = input.devEui.toUpperCase();

    try {
      await this.request(
        settings,
        'POST',
        `${settings.identityBaseUrl}/api/v3/applications/${encodeURIComponent(profile.applicationId)}/devices`,
        'identity create',
        {
          signal,
          body: {
            end_device: {
              ids: this.ids(ref, devEui, input.joinEui),
              join_server_address: clusterHost,
              network_server_address: clusterHost,
              application_server_address: clusterHost,
            },
            field_mask: {
              paths: [
                'join_server_address',
                'network_server_address',
                'application_server_address',
              ],
            },
          },
        },
      );
    } catch (error) {
      if (error instanceof TtiProvisioningError && error.kind === 'id_taken') {
        const existing = await this.getOrNull<{ ids?: { dev_eui?: string } }>(
          settings,
          this.deviceUrl(settings.identityBaseUrl, '', ref),
          'identity get',
          signal,
        );
        if (existing?.ids?.dev_eui?.toUpperCase() !== devEui) {
          throw new TtiProvisioningError(
            'eui_taken',
            'TTI identity create: device ID used by another DevEUI',
            409,
            error.ttiName,
          );
        }
      } else {
        // A create that timed out may still have landed.
        if (
          error instanceof TtiProvisioningError &&
          error.kind === 'unavailable'
        ) {
          await this.deleteDevice(profile.region, ref);
        }
        throw error;
      }
    }

    try {
      await this.setClusterServers(
        settings,
        cluster,
        clusterHost,
        input,
        signal,
      );
    } catch (error) {
      await this.deleteDevice(profile.region, ref);
      throw error;
    }
    return ref;
  }

  /**
   * Finishes a registration that exists on the Identity Server but not (fully)
   * on the cluster: sets the Join, Network and Application Server entries.
   */
  async completeOtaaDevice(
    input: CreateOtaaInput,
    signal?: AbortSignal,
  ): Promise<void> {
    const settings = this.settings();
    const cluster = this.clusterUrl(settings, input.profile.region);
    await this.setClusterServers(
      settings,
      cluster,
      new URL(cluster).hostname,
      input,
      signal,
    );
  }

  private ids(ref: TtiDeviceRef, devEui: string, joinEui: string) {
    return {
      device_id: ref.deviceId,
      dev_eui: devEui.toUpperCase(),
      join_eui: joinEui.toUpperCase(),
      application_ids: { application_id: ref.applicationId },
    };
  }

  private async setClusterServers(
    settings: TtiSettings,
    cluster: string,
    clusterHost: string,
    input: CreateOtaaInput,
    signal?: AbortSignal,
  ): Promise<void> {
    const { profile } = input;
    const ref = {
      applicationId: profile.applicationId,
      deviceId: input.deviceId,
    };
    const ids = this.ids(ref, input.devEui, input.joinEui);
    const idPaths = [
      'ids.device_id',
      'ids.dev_eui',
      'ids.join_eui',
      'ids.application_ids.application_id',
    ];

    await this.request(
      settings,
      'PUT',
      this.deviceUrl(cluster, 'js', ref),
      'join server set',
      {
        signal,
        body: {
          end_device: {
            ids,
            network_server_address: clusterHost,
            application_server_address: clusterHost,
            root_keys: { app_key: { key: input.appKey.toUpperCase() } },
          },
          field_mask: {
            paths: [
              ...idPaths,
              'network_server_address',
              'application_server_address',
              'root_keys.app_key.key',
            ],
          },
        },
      },
    );

    await this.request(
      settings,
      'PUT',
      this.deviceUrl(cluster, 'ns', ref),
      'network server set',
      {
        signal,
        body: {
          end_device: {
            ids,
            frequency_plan_id: profile.frequencyPlanId,
            lorawan_version: profile.lorawanVersion,
            lorawan_phy_version: profile.lorawanPhyVersion,
            supports_join: true,
            supports_class_c: profile.supportsClassC,
          },
          field_mask: {
            paths: [
              ...idPaths,
              'frequency_plan_id',
              'lorawan_version',
              'lorawan_phy_version',
              'supports_join',
              'supports_class_c',
            ],
          },
        },
      },
    );

    await this.request(
      settings,
      'PUT',
      this.deviceUrl(cluster, 'as', ref),
      'application server set',
      { signal, body: { end_device: { ids }, field_mask: { paths: idPaths } } },
    );
  }

  /** True when the Identity Server knows this device. */
  async deviceExists(
    ref: TtiDeviceRef,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const settings = this.settings();
    const device = await this.getOrNull(
      settings,
      `${this.deviceUrl(settings.identityBaseUrl, '', ref)}?field_mask=name`,
      'identity get',
      signal,
    );
    return device !== null;
  }

  /**
   * Removes a device from every cluster server (reverse order of creation),
   * then from the Identity Server. Best effort and idempotent: a server that
   * never had it counts as done; other failures are logged. Runs on its own
   * timeouts so cleanup still happens after the caller's deadline.
   */
  async deleteDevice(region: TtiRegion, ref: TtiDeviceRef): Promise<void> {
    const settings = this.settings();
    const cluster = settings.clusterBaseUrls[region];
    const urls = [
      ...(cluster
        ? (['as', 'ns', 'js'] as const).map((server) =>
            this.deviceUrl(cluster, server, ref),
          )
        : []),
      this.deviceUrl(settings.identityBaseUrl, '', ref),
    ];

    for (const url of urls) {
      try {
        await this.request(settings, 'DELETE', url, 'cleanup delete');
      } catch (error) {
        if (
          error instanceof TtiProvisioningError &&
          error.kind === 'not_found'
        ) {
          continue;
        }
        this.logger.error(
          `TTI cleanup of ${ref.applicationId}/${ref.deviceId} incomplete: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
