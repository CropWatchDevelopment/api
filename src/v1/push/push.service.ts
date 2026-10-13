import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService } from '../common/authz';
import { canRead } from '../common/permission-levels';
import { isStaffEmail } from '../common/owner-filter.helper';
import type { AuthenticatedUser } from '../auth/authenticated-user';

export interface PushRecipientCandidate {
  userId: string;
  displayName: string;
  pushEnabled: boolean;
}

export interface PushDeviceSummary {
  /** pushDeviceId of the browser's token; raw tokens never leave the API. */
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
}

@Injectable()
export class PushService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {}

  // Turns push on for the caller on this browser. Rows are per (browser
  // token, account), so a shared browser keeps every account that turned
  // push on there; re-registering only re-stamps the caller's own row.
  async registerToken(
    userId: string,
    token: string,
    deviceLabel?: string,
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('cw_push_tokens')
      .upsert(
        {
          token,
          user_id: userId,
          device_label: deviceLabel ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token,user_id' },
      );

    if (error) {
      throw new Error(`Failed to register push token: ${error.message}`);
    }
  }

  // App-load heartbeat. Never subscribes anyone: it only touches the
  // caller's existing row and reports whether there is one. When Firebase
  // has handed the browser a new token, every account on the browser moves
  // with it (knowing both tokens means the caller is on that browser), so a
  // rotation can't strand someone else's subscription on a dead token.
  async refreshToken(
    userId: string,
    token: string,
    previousToken?: string,
    deviceLabel?: string,
  ): Promise<boolean> {
    if (previousToken && previousToken !== token) {
      await this.moveBrowserToken(previousToken, token);
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('cw_push_tokens')
      .update({
        last_seen_at: new Date().toISOString(),
        ...(deviceLabel ? { device_label: deviceLabel } : {}),
      })
      .eq('token', token)
      .eq('user_id', userId)
      .select('token');

    if (error) {
      throw new Error(`Failed to refresh push token: ${error.message}`);
    }
    return ((data ?? []) as unknown[]).length > 0;
  }

  private async moveBrowserToken(
    previousToken: string,
    token: string,
  ): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('cw_push_tokens')
      .select('user_id, device_label, created_at')
      .eq('token', previousToken);

    if (error) {
      throw new Error(`Failed to load rotated push token: ${error.message}`);
    }
    const rows = (data ?? []) as Array<{
      user_id: string;
      device_label: string | null;
      created_at: string;
    }>;
    if (rows.length === 0) return;

    const { error: upsertError } = await client.from('cw_push_tokens').upsert(
      rows.map((row) => ({
        token,
        user_id: row.user_id,
        device_label: row.device_label,
        created_at: row.created_at,
        last_seen_at: new Date().toISOString(),
      })),
      { onConflict: 'token,user_id' },
    );
    if (upsertError) {
      throw new Error(
        `Failed to move rotated push token: ${upsertError.message}`,
      );
    }

    // The subscriptions moved, they didn't end: no rule cleanup here.
    const { error: deleteError } = await client
      .from('cw_push_tokens')
      .delete()
      .eq('token', previousToken);
    if (deleteError) {
      throw new Error(
        `Failed to drop rotated push token: ${deleteError.message}`,
      );
    }
  }

  // The caller turning push off on one of their devices (this browser, or
  // any device from their device list). When it was their last device they
  // asked to stop push alerts altogether, so they also come off every rule's
  // Push recipients. Dead-token pruning in the alert service never does
  // this: losing a device is not asking to stop alerts.
  async unregisterToken(userId: string, token: string): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const { error } = await client
      .from('cw_push_tokens')
      .delete()
      .eq('token', token)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to unregister push token: ${error.message}`);
    }

    const { count, error: countError } = await client
      .from('cw_push_tokens')
      .select('token', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      throw new Error(`Failed to count push tokens: ${countError.message}`);
    }
    if (count === 0) {
      await this.removeFromPushRules(userId);
    }
  }

  // Recipients live in config.recipient as a JSON string ({"userIds":[...]},
  // the LINE convention), so the query is only a substring pre-filter; the
  // exact match and the rewrite happen here.
  private async removeFromPushRules(userId: string): Promise<void> {
    const client = this.supabaseService.getAdminClient();
    const { data, error } = await client
      .from('cw_rule_template_actions')
      .select('id, config, cw_rule_action_types!inner(name)')
      .eq('cw_rule_action_types.name', 'Push')
      .like('config->>recipient', `%${userId}%`);

    if (error) {
      throw new Error(`Failed to load push rule actions: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{
      id: number;
      config: Record<string, unknown> | null;
    }>) {
      const recipient = parseRecipientSelection(row.config?.recipient);
      if (!recipient?.userIds.includes(userId)) continue;

      const { error: updateError } = await client
        .from('cw_rule_template_actions')
        .update({
          config: {
            ...row.config,
            recipient: JSON.stringify({
              ...recipient,
              userIds: recipient.userIds.filter((id) => id !== userId),
            }),
          },
        })
        .eq('id', row.id);

      if (updateError) {
        throw new Error(
          `Failed to update push rule action ${row.id}: ${updateError.message}`,
        );
      }
    }
  }

  // Removes one of the caller's devices by its list id. False when the id
  // isn't one of theirs.
  async removeDevice(userId: string, deviceId: string): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('cw_push_tokens')
      .select('token')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to list push tokens: ${error.message}`);
    }

    const token = ((data ?? []) as Array<{ token: string }>).find(
      (row) => pushDeviceId(row.token) === deviceId,
    )?.token;
    if (!token) return false;

    await this.unregisterToken(userId, token);
    return true;
  }

  async listTokens(userId: string): Promise<PushDeviceSummary[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('cw_push_tokens')
      .select('token, device_label, created_at, last_seen_at')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list push tokens: ${error.message}`);
    }

    return (
      (data ?? []) as Array<{
        token: string;
        device_label: string | null;
        created_at: string;
        last_seen_at: string;
      }>
    ).map((row) => ({
      id: pushDeviceId(row.token),
      deviceLabel: row.device_label,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  // Users eligible as push recipients for a rule: everyone with view access
  // to any of the given devices, scoped to devices the CALLER can view.
  // CropWatch staff are left out unless the caller is staff. Users without a
  // registered token are included (flagged) so the rule form can show them
  // as not yet subscribed.
  async listEligibleRecipients(
    user: AuthenticatedUser,
    devEuis: string[],
  ): Promise<PushRecipientCandidate[]> {
    const client = this.supabaseService.getAdminClient();

    const managed = await this.accessService.listAccessibleDevices(user);
    const viewable = new Set(
      managed.filter((device) => device.canView).map((device) => device.devEui),
    );
    const scoped = devEuis.filter((devEui) => viewable.has(devEui));
    if (scoped.length === 0) return [];

    const { data: devices, error: devicesError } = await client
      .from('cw_devices')
      .select('user_id, cw_device_owners(user_id, permission_level)')
      .in('dev_eui', scoped);

    if (devicesError) {
      throw new Error(`Failed to load device viewers: ${devicesError.message}`);
    }

    const viewerIds = new Set<string>();
    for (const device of (devices ?? []) as Array<{
      user_id: string | null;
      cw_device_owners?: Array<{
        user_id: string | null;
        permission_level: number | null;
      }> | null;
    }>) {
      if (device.user_id) viewerIds.add(device.user_id);
      for (const owner of device.cw_device_owners ?? []) {
        if (owner.user_id && canRead(owner.permission_level)) {
          viewerIds.add(owner.user_id);
        }
      }
    }
    if (viewerIds.size === 0) return [];

    const { data: profiles, error: profilesError } = await client
      .from('profiles')
      .select('id, full_name, username, email')
      .in('id', [...viewerIds]);

    if (profilesError) {
      throw new Error(`Failed to load profiles: ${profilesError.message}`);
    }

    const { data: tokenRows, error: tokensError } = await client
      .from('cw_push_tokens')
      .select('user_id')
      .in('user_id', [...viewerIds]);

    if (tokensError) {
      throw new Error(`Failed to load push tokens: ${tokensError.message}`);
    }

    const enrolled = new Set(
      ((tokenRows ?? []) as Array<{ user_id: string }>).map(
        (row) => row.user_id,
      ),
    );

    // Staff hold support access to customer devices; customers must not see
    // them in recipient lists (same rule as filterStaffOwnerRows).
    return (
      (profiles ?? []) as Array<{
        id: string;
        full_name: string | null;
        username: string | null;
        email: string | null;
      }>
    )
      .filter((profile) => user.isStaff || !isStaffEmail(profile.email))
      .map((profile) => ({
        userId: profile.id,
        displayName:
          profile.full_name ?? profile.username ?? profile.email ?? profile.id,
        pushEnabled: enrolled.has(profile.id),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}

function parseRecipientSelection(
  value: unknown,
): { userIds: unknown[]; [key: string]: unknown } | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { userIds?: unknown }).userIds)
    ) {
      return parsed as { userIds: unknown[] };
    }
  } catch {
    // Not a {"userIds":[...]} selection — nothing to remove.
  }
  return null;
}

// Device ids for the profile device list: a SHA-256 of the browser's token,
// so raw tokens never reach a browser. The app hashes its own stored token
// the same way to tell which listed device it is.
export function pushDeviceId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
