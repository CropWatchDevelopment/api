import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import { MailService } from '../common/mail/mail.service';
import {
  AccessService,
  Action,
  type OrgRole,
  assertCanEditMember,
  assertCanInvite,
  assertCanRemove,
  assertCanSuspend,
  orgCapabilitiesFor,
} from '../common/authz';
import { isStaffEmail } from '../common/owner-filter.helper';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type { TableRow } from '../types/supabase';
import {
  CreateInviteDto,
  CreateLinkRequestDto,
  LocationGrantDto,
  UpdateMemberDto,
} from './dto/organizations.dtos';

type OrgRow = TableRow<'organizations'>;
type MemberRow = TableRow<'organization_members'>;
type InviteRow = TableRow<'organization_invites'>;
type QueryResult<T> = { data: T | null; error: PostgrestError | null };

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (review question 3)
const MAX_PENDING_INVITES = 50;

/** RPC exception prefix (raised in 025's functions) → HTTP error. */
const RPC_ERROR_MAP: Array<[string, (msg: string) => Error]> = [
  ['INVITE_NOT_FOUND', () => new NotFoundException('Invite not found')],
  ['INVITE_EXPIRED', () => new ConflictException('This invite has expired')],
  [
    'INVITE_NOT_PENDING',
    () => new ConflictException('This invite is no longer open'),
  ],
  [
    'INVITE_EMAIL_MISMATCH',
    () =>
      new ForbiddenException(
        'This invite was sent to a different email address',
      ),
  ],
  [
    'ALREADY_FULL_MEMBER',
    () =>
      new ConflictException(
        'You already belong to an organization — leave it before accepting',
      ),
  ],
  [
    'PERSONAL_ORG_NOT_EMPTY',
    () =>
      new ConflictException(
        'Your personal organization still has locations, devices, or a subscription — move or delete them first',
      ),
  ],
  [
    'PERSONAL_ORG_INVITE',
    () => new ConflictException('Personal organizations only take guests'),
  ],
  [
    'OWNER_CANNOT_LEAVE',
    () =>
      new ForbiddenException(
        'The owner cannot leave — transfer ownership first',
      ),
  ],
  ['ORG_DEACTIVATED', () => new NotFoundException('Organization not found')],
  [
    'ORG_NESTING',
    () => new ConflictException('Sub-organizations can only nest one level'),
  ],
  [
    'CHILD_ALREADY_LINKED',
    () => new ConflictException('That organization is already linked'),
  ],
  ['PARENT_DEACTIVATED', () => new NotFoundException('Organization not found')],
  [
    'LINK_REQUEST_NOT_PENDING',
    () => new ConflictException('This link request is no longer open'),
  ],
  [
    'TRANSFER_PERSONAL',
    () =>
      new ConflictException(
        'A personal organization cannot be transferred — convert it to a company first',
      ),
  ],
  [
    'NEW_OWNER_NOT_FULL_MEMBER',
    () =>
      new ConflictException(
        'The new owner must already be an active manager or member of the organization',
      ),
  ],
  ['CONVERT_FAILED', (m) => new ConflictException(m)],
  ['NO_CURRENT_OWNER', (m) => new InternalServerErrorException(m)],
];

function mapRpcError(error: PostgrestError): Error {
  for (const [prefix, factory] of RPC_ERROR_MAP) {
    if (error.message.includes(prefix)) {
      return factory(error.message);
    }
  }
  return new InternalServerErrorException('Organization operation failed');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private get orgsEnabled(): boolean {
    return this.configService.get<string>('ORGS_ENABLED') === 'true';
  }

  /** 404 (never 403) when the org feature flag is off. */
  private assertOrgsEnabled(): void {
    if (!this.orgsEnabled) {
      throw new NotFoundException('Organizations are not enabled');
    }
  }

  // -------------------------------------------------------------------------
  // Me
  // -------------------------------------------------------------------------

  async getMeContext(user: AuthenticatedUser) {
    const ctx = await this.accessService.getOrgContext(user);
    const client = this.supabaseService.getClient();

    let childOrgs: Array<{ id: string; name: string }> = [];
    if (ctx.parentReadOrgIds.length > 0) {
      const { data } = (await client
        .from('organizations')
        .select('id, name')
        .in('id', ctx.parentReadOrgIds)) as QueryResult<
        Array<{ id: string; name: string }>
      >;
      childOrgs = data ?? [];
    }

    return {
      orgs_enabled: this.orgsEnabled,
      is_staff: user.isStaff,
      suspended: ctx.suspended,
      org: ctx.org
        ? {
            id: ctx.org.id,
            type: ctx.org.type,
            name: ctx.org.name,
            role: ctx.org.role,
            capabilities: orgCapabilitiesFor(ctx.org.role),
          }
        : null,
      guest_orgs: ctx.guestSeats.map((seat) => ({
        id: seat.orgId,
        name: seat.orgName,
        expires_at: seat.expiresAt,
      })),
      child_orgs: childOrgs,
    };
  }

  // -------------------------------------------------------------------------
  // Org basics
  // -------------------------------------------------------------------------

  private async loadOrg(orgId: string): Promise<OrgRow> {
    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle()) as QueryResult<OrgRow>;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch organization');
    }
    if (!data || data.deactivated_at != null) {
      throw new NotFoundException('Organization not found');
    }
    return data;
  }

  async getOrg(user: AuthenticatedUser, orgId: string) {
    await this.accessService.assertOrgAction(user, orgId, Action.OrgRead);
    const org = await this.loadOrg(orgId);

    let parentName: string | null = null;
    if (org.parent_org_id) {
      const client = this.supabaseService.getClient();
      const { data } = (await client
        .from('organizations')
        .select('name')
        .eq('id', org.parent_org_id)
        .maybeSingle()) as QueryResult<{ name: string }>;
      parentName = data?.name ?? null;
    }

    const ctx = await this.accessService.getOrgContext(user);
    const role: OrgRole | 'staff' | null =
      ctx.org?.id === orgId
        ? ctx.org.role
        : ctx.guestOrgIds.includes(orgId)
          ? 'guest'
          : user.isStaff
            ? 'staff'
            : null;

    return {
      id: org.id,
      type: org.type,
      name: org.name,
      role,
      parent: org.parent_org_id
        ? { id: org.parent_org_id, name: parentName }
        : null,
      created_at: org.created_at,
    };
  }

  async renameOrg(user: AuthenticatedUser, orgId: string, name: string) {
    await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgSettingsManage,
    );
    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('organizations')
      .update({ name })
      .eq('id', orgId)
      .is('deactivated_at', null);
    if (error) {
      throw new InternalServerErrorException('Failed to rename organization');
    }
    return { id: orgId, name };
  }

  async upgradeOrg(user: AuthenticatedUser, orgId: string, name: string) {
    this.assertOrgsEnabled();
    await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgSettingsManage,
    );
    const client = this.supabaseService.getClient();
    const { error } = await client.rpc('convert_org_to_company', {
      p_org_id: orgId,
      p_name: name,
      p_converted_by: user.sub,
    });
    if (error) {
      throw mapRpcError(error);
    }
    return { id: orgId, type: 'company', name };
  }

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  private async loadMembership(
    orgId: string,
    userId: string,
  ): Promise<MemberRow> {
    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organization_members')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()) as QueryResult<MemberRow>;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch membership');
    }
    if (!data) {
      throw new NotFoundException('Member not found');
    }
    return data;
  }

  /** The caller's role used for member-management policy (staff act as owner). */
  private async actorRole(
    user: AuthenticatedUser,
    orgId: string,
  ): Promise<OrgRole> {
    if (user.isStaff) return 'owner';
    const ctx = await this.accessService.getOrgContext(user);
    if (ctx.org?.id !== orgId) {
      throw new NotFoundException('Organization not found');
    }
    return ctx.org.role;
  }

  async listMembers(user: AuthenticatedUser, orgId: string) {
    const ctx = await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgRead,
    );
    const role: OrgRole | null = user.isStaff
      ? 'owner'
      : ctx.org?.id === orgId
        ? ctx.org.role
        : ctx.guestOrgIds.includes(orgId)
          ? 'guest'
          : null;

    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organization_members')
      .select(
        'user_id, role, status, expires_at, created_at, suspended_at, profiles(email, full_name)',
      )
      .eq('org_id', orgId)) as QueryResult<
      Array<
        Pick<
          MemberRow,
          | 'user_id'
          | 'role'
          | 'status'
          | 'expires_at'
          | 'created_at'
          | 'suspended_at'
        > & {
          profiles: { email: string | null; full_name: string | null } | null;
        }
      >
    >;
    if (error) {
      throw new InternalServerErrorException('Failed to list members');
    }

    let rows = data ?? [];
    if (role === 'member' || role === 'guest') {
      // Members and guests see only themselves.
      rows = rows.filter((row) => row.user_id === user.sub);
    } else {
      if (role !== 'owner') {
        // Guests are hidden from non-owners.
        rows = rows.filter((row) => row.role !== 'guest');
      }
      if (!user.isStaff) {
        // Staff support rows are hidden from customers.
        rows = rows.filter((row) => !isStaffEmail(row.profiles?.email));
      }
    }

    return rows.map((row) => ({
      user_id: row.user_id,
      email: row.profiles?.email ?? null,
      full_name: row.profiles?.full_name ?? null,
      role: row.role,
      status: row.status,
      expires_at: row.expires_at,
      suspended_at: row.suspended_at,
      created_at: row.created_at,
    }));
  }

  async updateMember(
    user: AuthenticatedUser,
    orgId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ) {
    const actor = await this.actorRole(user, orgId);
    const target = await this.loadMembership(orgId, targetUserId);

    assertCanEditMember(
      actor,
      target.role as OrgRole,
      targetUserId === user.sub,
      dto.role,
    );

    const client = this.supabaseService.getClient();

    if (dto.role !== undefined && dto.role !== target.role) {
      const { error } = await client
        .from('organization_members')
        .update({ role: dto.role })
        .eq('org_id', orgId)
        .eq('user_id', targetUserId);
      if (error) {
        throw new InternalServerErrorException('Failed to update member role');
      }
    }

    if (dto.location_grants !== undefined) {
      await this.applyLocationGrants(
        user,
        orgId,
        targetUserId,
        target.role as OrgRole,
        dto.location_grants,
      );
    }

    return {
      org_id: orgId,
      user_id: targetUserId,
      role: dto.role ?? target.role,
    };
  }

  private async applyLocationGrants(
    user: AuthenticatedUser,
    orgId: string,
    targetUserId: string,
    targetRole: OrgRole,
    grants: LocationGrantDto[],
  ): Promise<void> {
    const client = this.supabaseService.getClient();

    for (const grant of grants) {
      if (targetRole === 'guest' && grant.default_role < 4) {
        throw new BadRequestException('Guests are capped at Viewer (4)');
      }
      const { data: location, error: locationError } = (await client
        .from('cw_locations')
        .select('location_id')
        .eq('location_id', grant.location_id)
        .eq('org_id', orgId)
        .maybeSingle()) as QueryResult<{ location_id: number }>;
      if (locationError) {
        throw new InternalServerErrorException('Failed to verify location');
      }
      if (!location) {
        throw new BadRequestException(
          `Location ${grant.location_id} does not belong to this organization`,
        );
      }
      const { error } = await client.from('cw_location_owners').upsert(
        {
          location_id: grant.location_id,
          user_id: targetUserId,
          permission_level: grant.default_role,
          is_active: true,
          admin_user_id: user.sub,
        },
        { onConflict: 'location_id,user_id' },
      );
      if (error) {
        throw new InternalServerErrorException(
          'Failed to update location access',
        );
      }
    }
  }

  async suspendMember(
    user: AuthenticatedUser,
    orgId: string,
    targetUserId: string,
  ) {
    const actor = await this.actorRole(user, orgId);
    const target = await this.loadMembership(orgId, targetUserId);
    assertCanSuspend(actor, target.role as OrgRole, targetUserId === user.sub);

    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('organization_members')
      .update({
        status: 'suspended',
        suspended_at: new Date().toISOString(),
        suspended_by: user.sub,
      })
      .eq('org_id', orgId)
      .eq('user_id', targetUserId);
    if (error) {
      throw new InternalServerErrorException('Failed to suspend member');
    }

    // Pending invites the suspended user sent are revoked (plan 4.3).
    await client
      .from('organization_invites')
      .update({ status: 'revoked' })
      .eq('org_id', orgId)
      .eq('invited_by', targetUserId)
      .eq('status', 'pending');

    return { org_id: orgId, user_id: targetUserId, status: 'suspended' };
  }

  async reinstateMember(
    user: AuthenticatedUser,
    orgId: string,
    targetUserId: string,
  ) {
    const actor = await this.actorRole(user, orgId);
    const target = await this.loadMembership(orgId, targetUserId);
    // Reinstating follows the same authority rules as suspending.
    assertCanSuspend(actor, target.role as OrgRole, targetUserId === user.sub);

    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('organization_members')
      .update({ status: 'active', suspended_at: null, suspended_by: null })
      .eq('org_id', orgId)
      .eq('user_id', targetUserId);
    if (error) {
      throw new InternalServerErrorException('Failed to reinstate member');
    }
    return { org_id: orgId, user_id: targetUserId, status: 'active' };
  }

  async removeMember(
    user: AuthenticatedUser,
    orgId: string,
    targetUserId: string,
  ) {
    const isSelf = targetUserId === user.sub;
    const actor = isSelf
      ? ((await this.loadMembership(orgId, user.sub)).role as OrgRole)
      : await this.actorRole(user, orgId);
    const target = await this.loadMembership(orgId, targetUserId);
    assertCanRemove(actor, target.role as OrgRole, isSelf);

    const client = this.supabaseService.getClient();
    const { data, error } = (await client.rpc('remove_org_member', {
      p_org_id: orgId,
      p_user_id: targetUserId,
    })) as QueryResult<Record<string, unknown>>;
    if (error) {
      throw mapRpcError(error);
    }
    return data ?? { removed: true };
  }

  // -------------------------------------------------------------------------
  // Invites
  // -------------------------------------------------------------------------

  async createInvite(
    user: AuthenticatedUser,
    orgId: string,
    dto: CreateInviteDto,
  ) {
    this.assertOrgsEnabled();
    const actor = await this.actorRole(user, orgId);
    if (!user.isStaff) {
      assertCanInvite(actor, dto.role);
    }
    const org = await this.loadOrg(orgId);
    if (org.type === 'personal' && dto.role !== 'guest') {
      throw new ConflictException(
        'A personal organization only takes guests — upgrade to a company first',
      );
    }
    if (dto.role !== 'guest' && dto.member_expires_at) {
      throw new BadRequestException('Only guest invites can carry an expiry');
    }
    for (const grant of dto.location_grants ?? []) {
      if (dto.role === 'guest' && grant.default_role < 4) {
        throw new BadRequestException('Guests are capped at Viewer (4)');
      }
    }

    const client = this.supabaseService.getClient();
    const { count } = await client
      .from('organization_invites')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'pending');
    if ((count ?? 0) >= MAX_PENDING_INVITES) {
      throw new ConflictException(
        `An organization can have at most ${MAX_PENDING_INVITES} pending invites`,
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    const { data, error } = (await client
      .from('organization_invites')
      .insert({
        org_id: orgId,
        email: dto.email.trim().toLowerCase(),
        token_hash: sha256(token),
        role: dto.role,
        location_grants: dto.location_grants ?? null,
        member_expires_at: dto.member_expires_at ?? null,
        invited_by: user.sub,
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single()) as QueryResult<{ id: string; expires_at: string }>;

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'An invite for this email is already pending',
        );
      }
      throw new InternalServerErrorException('Failed to create invite');
    }

    await this.sendInviteEmail(dto.email, org.name, dto.role, token, expiresAt);
    return { id: data?.id, expires_at: data?.expires_at };
  }

  private async sendInviteEmail(
    email: string,
    orgName: string,
    role: string,
    token: string,
    expiresAt: string,
  ): Promise<void> {
    const base =
      this.configService.get<string>('APP_PUBLIC_URL') ??
      'https://app.cropwatch.io';
    const link = `${base.replace(/\/+$/, '')}/auth/invite/${token}`;
    await this.mailService.send({
      to: email,
      subject: `You're invited to ${orgName} on CropWatch`,
      text: [
        `You have been invited to join ${orgName} on CropWatch as a ${role}.`,
        '',
        `Accept the invite: ${link}`,
        '',
        `This invite expires on ${new Date(expiresAt).toUTCString()}.`,
        'If you were not expecting this invitation you can ignore this email.',
      ].join('\n'),
    });
  }

  async listInvites(user: AuthenticatedUser, orgId: string) {
    const actor = await this.actorRole(user, orgId);
    if (actor !== 'owner' && actor !== 'manager') {
      throw new ForbiddenException(
        'You do not have permission to view invites',
      );
    }
    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organization_invites')
      .select(
        'id, email, role, status, expires_at, created_at, member_expires_at, invited_by',
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })) as QueryResult<InviteRow[]>;
    if (error) {
      throw new InternalServerErrorException('Failed to list invites');
    }
    let rows = data ?? [];
    if (actor !== 'owner') {
      rows = rows.filter((row) => row.role !== 'guest');
    }
    return rows;
  }

  async revokeInvite(user: AuthenticatedUser, orgId: string, inviteId: string) {
    const actor = await this.actorRole(user, orgId);
    const invite = await this.loadInvite(orgId, inviteId);
    if (!user.isStaff) {
      assertCanInvite(actor, invite.role as OrgRole);
    }
    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('organization_invites')
      .update({ status: 'revoked' })
      .eq('id', inviteId)
      .eq('org_id', orgId)
      .eq('status', 'pending');
    if (error) {
      throw new InternalServerErrorException('Failed to revoke invite');
    }
    return { id: inviteId, status: 'revoked' };
  }

  async resendInvite(user: AuthenticatedUser, orgId: string, inviteId: string) {
    this.assertOrgsEnabled();
    const actor = await this.actorRole(user, orgId);
    const invite = await this.loadInvite(orgId, inviteId);
    if (!user.isStaff) {
      assertCanInvite(actor, invite.role as OrgRole);
    }
    if (invite.status !== 'pending') {
      throw new ConflictException('Only pending invites can be resent');
    }
    const org = await this.loadOrg(orgId);

    // Resending rotates the token (review question 3).
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('organization_invites')
      .update({ token_hash: sha256(token), expires_at: expiresAt })
      .eq('id', inviteId)
      .eq('org_id', orgId)
      .eq('status', 'pending');
    if (error) {
      throw new InternalServerErrorException('Failed to resend invite');
    }

    await this.sendInviteEmail(
      invite.email,
      org.name,
      invite.role,
      token,
      expiresAt,
    );
    return { id: inviteId, expires_at: expiresAt };
  }

  private async loadInvite(
    orgId: string,
    inviteId: string,
  ): Promise<InviteRow> {
    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organization_invites')
      .select('*')
      .eq('id', inviteId)
      .eq('org_id', orgId)
      .maybeSingle()) as QueryResult<InviteRow>;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch invite');
    }
    if (!data) {
      throw new NotFoundException('Invite not found');
    }
    return data;
  }

  /** Public preview: never confirms account existence, masks the email. */
  async previewInvite(token: string) {
    this.assertOrgsEnabled();
    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organization_invites')
      .select(
        'email, role, status, expires_at, organizations(name), profiles:invited_by(full_name, email)',
      )
      .eq('token_hash', sha256(token))
      .maybeSingle()) as QueryResult<{
      email: string;
      role: string;
      status: string;
      expires_at: string;
      organizations: { name: string } | null;
      profiles: { full_name: string | null; email: string | null } | null;
    }>;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch invite');
    }
    if (!data) {
      throw new NotFoundException('Invite not found');
    }
    const expired =
      data.status === 'pending' && Date.parse(data.expires_at) <= Date.now();
    return {
      org_name: data.organizations?.name ?? null,
      role: data.role,
      status: expired ? 'expired' : data.status,
      masked_email: maskEmail(data.email),
      invited_by:
        data.profiles?.full_name ??
        (data.profiles?.email ? maskEmail(data.profiles.email) : null),
      expires_at: data.expires_at,
    };
  }

  async acceptInvite(user: AuthenticatedUser, token: string) {
    this.assertOrgsEnabled();
    const client = this.supabaseService.getClient();
    const { data, error } = (await client.rpc('accept_org_invite', {
      p_token_hash: sha256(token),
      p_user_id: user.sub,
    })) as QueryResult<Record<string, unknown>>;
    if (error) {
      throw mapRpcError(error);
    }
    return data;
  }

  // -------------------------------------------------------------------------
  // Parent / sub-organization links
  // -------------------------------------------------------------------------

  async listChildren(user: AuthenticatedUser, orgId: string) {
    await this.accessService.assertOrgAction(user, orgId, Action.OrgRead);
    const client = this.supabaseService.getClient();
    const [children, requests] = await Promise.all([
      client
        .from('organizations')
        .select('id, name, type')
        .eq('parent_org_id', orgId)
        .is('deactivated_at', null),
      client
        .from('organization_link_requests')
        .select('id, child_org_id, status, created_at')
        .eq('parent_org_id', orgId)
        .eq('status', 'pending'),
    ]);
    if (children.error || requests.error) {
      throw new InternalServerErrorException('Failed to list children');
    }
    return {
      children: children.data ?? [],
      pending_requests: requests.data ?? [],
    };
  }

  async createLinkRequest(
    user: AuthenticatedUser,
    orgId: string,
    dto: CreateLinkRequestDto,
  ) {
    this.assertOrgsEnabled();
    await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgSettingsManage,
    );
    if (dto.child_org_id === orgId) {
      throw new BadRequestException(
        'An organization cannot be linked to itself',
      );
    }
    // The child must exist and be active; do not leak more than that.
    await this.loadOrg(dto.child_org_id);

    const client = this.supabaseService.getClient();
    const { data, error } = (await client
      .from('organization_link_requests')
      .insert({
        parent_org_id: orgId,
        child_org_id: dto.child_org_id,
        requested_by: user.sub,
      })
      .select('id')
      .single()) as QueryResult<{ id: string }>;
    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('A link request is already pending');
      }
      throw new InternalServerErrorException('Failed to create link request');
    }
    return { id: data?.id, status: 'pending' };
  }

  async listParentRequests(user: AuthenticatedUser, orgId: string) {
    await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgSettingsManage,
    );
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('organization_link_requests')
      .select(
        'id, parent_org_id, status, created_at, organizations:parent_org_id(name)',
      )
      .eq('child_org_id', orgId)
      .eq('status', 'pending');
    if (error) {
      throw new InternalServerErrorException(
        'Failed to list parent link requests',
      );
    }
    return data ?? [];
  }

  async decideParentRequest(
    user: AuthenticatedUser,
    orgId: string,
    requestId: string,
    accept: boolean,
  ) {
    this.assertOrgsEnabled();
    await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgSettingsManage,
    );
    const client = this.supabaseService.getClient();

    if (accept) {
      const { error } = await client.rpc('accept_org_link', {
        p_request_id: requestId,
        p_decided_by: user.sub,
      });
      if (error) {
        throw mapRpcError(error);
      }
      return { id: requestId, status: 'accepted' };
    }

    const { error } = await client
      .from('organization_link_requests')
      .update({
        status: 'declined',
        decided_by: user.sub,
        decided_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('child_org_id', orgId)
      .eq('status', 'pending');
    if (error) {
      throw new InternalServerErrorException('Failed to decline link request');
    }
    return { id: requestId, status: 'declined' };
  }

  async unlinkChild(user: AuthenticatedUser, orgId: string, childId: string) {
    await this.accessService.assertOrgAction(
      user,
      orgId,
      Action.OrgSettingsManage,
    );
    const child = await this.loadOrg(childId);
    if (child.parent_org_id !== orgId) {
      throw new NotFoundException('That organization is not a child of yours');
    }
    const client = this.supabaseService.getClient();
    const { error } = await client.rpc('unlink_org', {
      p_child_org_id: childId,
    });
    if (error) {
      throw mapRpcError(error);
    }
    return { id: childId, unlinked: true };
  }

  // -------------------------------------------------------------------------
  // Staff admin
  // -------------------------------------------------------------------------

  async adminSearchOrgs(q?: string, includeDeactivated = false) {
    const client = this.supabaseService.getClient();
    let query = client
      .from('organizations')
      .select(
        'id, type, name, home_of_user_id, parent_org_id, deactivated_at, created_at',
      )
      .order('name');
    if (!includeDeactivated) {
      query = query.is('deactivated_at', null);
    }
    if (q && q.trim()) {
      query = query.ilike('name', `%${q.trim()}%`);
    }
    const { data, error } = await query.limit(100);
    if (error) {
      throw new InternalServerErrorException('Failed to search organizations');
    }
    return data ?? [];
  }

  async adminConvertOrg(user: AuthenticatedUser, orgId: string, name: string) {
    const client = this.supabaseService.getClient();
    const { error } = await client.rpc('convert_org_to_company', {
      p_org_id: orgId,
      p_name: name,
      p_converted_by: user.sub,
    });
    if (error) {
      throw mapRpcError(error);
    }
    return { id: orgId, type: 'company', name };
  }

  async adminTransferOwnership(orgId: string, newOwnerUserId: string) {
    const client = this.supabaseService.getClient();
    const { error } = await client.rpc('transfer_org_ownership', {
      p_org_id: orgId,
      p_new_owner: newOwnerUserId,
    });
    if (error) {
      throw mapRpcError(error);
    }
    return { id: orgId, owner_user_id: newOwnerUserId };
  }

  async adminLinkOrgs(
    user: AuthenticatedUser,
    parentOrgId: string,
    childOrgId: string,
  ) {
    const client = this.supabaseService.getClient();
    // Staff link directly: create an accepted request for the audit trail,
    // then apply the link through the same RPC the child-owner path uses.
    const { data, error } = (await client
      .from('organization_link_requests')
      .insert({
        parent_org_id: parentOrgId,
        child_org_id: childOrgId,
        requested_by: user.sub,
      })
      .select('id')
      .single()) as QueryResult<{ id: string }>;
    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictException('A link request is already pending');
      }
      throw new InternalServerErrorException('Failed to create link request');
    }
    const { error: acceptError } = await client.rpc('accept_org_link', {
      p_request_id: data.id,
      p_decided_by: user.sub,
    });
    if (acceptError) {
      throw mapRpcError(acceptError);
    }
    return { parent_org_id: parentOrgId, child_org_id: childOrgId };
  }

  async adminUnlinkOrg(childOrgId: string) {
    const client = this.supabaseService.getClient();
    const { error } = await client.rpc('unlink_org', {
      p_child_org_id: childOrgId,
    });
    if (error) {
      throw mapRpcError(error);
    }
    return { id: childOrgId, unlinked: true };
  }
}
