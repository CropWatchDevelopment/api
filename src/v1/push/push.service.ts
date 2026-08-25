import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { listManagedDevices } from '../common/managed-devices.helper';
import { canRead } from '../common/permission-levels';
import type { AuthenticatedUser } from '../auth/authenticated-user';

export interface PushRecipientCandidate {
  userId: string;
  displayName: string;
  pushEnabled: boolean;
}

export interface PushTokenSummary {
  token: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
}

@Injectable()
export class PushService {
  constructor(private readonly supabaseService: SupabaseService) {}

  // Idempotent: re-registering after a page reload or FCM token refresh
  // re-stamps last_seen_at; a different account on the same browser takes
  // the token over (a token addresses one browser profile).
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
        { onConflict: 'token' },
      );

    if (error) {
      throw new Error(`Failed to register push token: ${error.message}`);
    }
  }

  async unregisterToken(userId: string, token: string): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('cw_push_tokens')
      .delete()
      .eq('token', token)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to unregister push token: ${error.message}`);
    }
  }

  async listTokens(userId: string): Promise<PushTokenSummary[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('cw_push_tokens')
      .select('token, device_label, created_at, last_seen_at')
      .eq('user_id', userId);

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
      token: row.token,
      deviceLabel: row.device_label,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }));
  }

  // Users eligible as push recipients for a rule: everyone with view access
  // to any of the given devices, scoped to devices the CALLER can view.
  // Users without a registered token are included (flagged) — they start
  // receiving alerts the moment they enroll a device.
  async listEligibleRecipients(
    user: AuthenticatedUser,
    devEuis: string[],
  ): Promise<PushRecipientCandidate[]> {
    const client = this.supabaseService.getAdminClient();

    const managed = await listManagedDevices(client, user.sub, user.isStaff);
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

    return (
      (profiles ?? []) as Array<{
        id: string;
        full_name: string | null;
        username: string | null;
        email: string | null;
      }>
    )
      .map((profile) => ({
        userId: profile.id,
        displayName:
          profile.full_name ?? profile.username ?? profile.email ?? profile.id,
        pushEnabled: enrolled.has(profile.id),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
