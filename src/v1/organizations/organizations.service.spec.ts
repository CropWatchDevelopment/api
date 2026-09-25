import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrganizationsService } from './organizations.service';
import { OrganizationsModule } from './organizations.module';
import { SupabaseService } from '../../supabase/supabase.service';
import { MailService } from '../common/mail/mail.service';
import { AccessService, emptyOrgContext } from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';

const ORG = '11111111-1111-4111-8111-111111111111';

type Result = { data: unknown; error: unknown; count?: number | null };

const builder = (result: Result) => {
  const b: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'in',
    'ilike',
    'order',
    'limit',
    'insert',
    'update',
    'upsert',
    'delete',
  ]) {
    b[method] = jest.fn(() => b);
  }
  b.maybeSingle = jest.fn(() => Promise.resolve(result));
  b.single = jest.fn(() => Promise.resolve(result));
  b.then = (
    resolve: (value: Result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return b as Record<string, jest.Mock> & {
    then: (r: (value: Result) => unknown) => Promise<unknown>;
  };
};

function makeService(options: {
  tables?: Record<string, Result[]>;
  rpc?: jest.Mock;
  orgsEnabled?: boolean;
  ctx?: Partial<ReturnType<typeof emptyOrgContext>>;
}) {
  const queues: Record<string, Result[]> = options.tables ?? {};
  const from = jest.fn((table: string) => {
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected table ${table}`);
    }
    return builder(queue.shift() as Result);
  });
  const rpc =
    options.rpc ?? jest.fn().mockResolvedValue({ data: {}, error: null });
  const client = { from, rpc };
  const ctx = { ...emptyOrgContext(false), ...options.ctx };
  const accessService = {
    getOrgContext: jest.fn().mockResolvedValue(ctx),
    assertOrgAction: jest.fn().mockResolvedValue(ctx),
  } as unknown as AccessService;
  const mail = { send: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) =>
      key === 'ORGS_ENABLED'
        ? options.orgsEnabled === false
          ? 'false'
          : 'true'
        : key === 'APP_PUBLIC_URL'
          ? 'https://app.example.com'
          : undefined,
    ),
  } as unknown as ConfigService;

  const service = new OrganizationsService(
    {
      getClient: jest.fn(() => client),
      getAdminClient: jest.fn(),
    } as unknown as SupabaseService,
    accessService,
    mail as unknown as MailService,
    config,
  );
  return { service, from, rpc, mail, accessService };
}

const USER: AuthenticatedUser = {
  sub: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  isStaff: false,
};

const ownerCtx = {
  org: {
    id: ORG,
    type: 'company' as const,
    name: 'Acme',
    role: 'owner' as const,
  },
  managedOrgIds: [ORG],
};

const orgRow = (over: Record<string, unknown> = {}) => ({
  id: ORG,
  type: 'company',
  name: 'Acme',
  home_of_user_id: USER.sub,
  parent_org_id: null,
  deactivated_at: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('OrganizationsService', () => {
  it('module wires with mocked providers (DI sanity)', async () => {
    // SupabaseModule's client factories read env before overrides apply.
    process.env.PRIVATE_SUPABASE_URL = 'https://stub.supabase.co';
    process.env.PRIVATE_SUPABASE_ANON_KEY = 'stub-anon';
    process.env.PRIVATE_SUPABASE_SERVICE_ROLE_KEY = 'stub-service';
    const moduleRef = await Test.createTestingModule({
      imports: [OrganizationsModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({ getClient: jest.fn(), getAdminClient: jest.fn() })
      .overrideProvider(MailService)
      .useValue({ send: jest.fn() })
      .compile();
    expect(moduleRef.get(OrganizationsService)).toBeDefined();
  });

  describe('feature flag', () => {
    it('invite endpoints 404 when ORGS_ENABLED is off', async () => {
      const { service } = makeService({ orgsEnabled: false, ctx: ownerCtx });
      await expect(
        service.createInvite(USER, ORG, {
          email: 'a@example.com',
          role: 'member',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.previewInvite('token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.acceptInvite(USER, 'token')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('invites', () => {
    const inviteTables = () => ({
      organizations: [{ data: orgRow(), error: null }],
      organization_invites: [
        { data: null, error: null, count: 0 }, // pending count
        { data: { id: 'inv-1', expires_at: 'later' }, error: null }, // insert
      ],
    });

    it('creates an invite, hashes the token, and emails the link', async () => {
      const { service, mail } = makeService({
        tables: inviteTables(),
        ctx: ownerCtx,
      });
      const result = await service.createInvite(USER, ORG, {
        email: 'New.Member@Example.com',
        role: 'member',
      });
      expect(result).toEqual({ id: 'inv-1', expires_at: 'later' });
      const sendMock = mail.send as unknown as jest.Mock<
        Promise<void>,
        [{ to: string; subject: string; text: string }]
      >;
      const message = sendMock.mock.calls[0][0];
      expect(message.to).toBe('New.Member@Example.com');
      expect(message.text).toContain('https://app.example.com/auth/invite/');
      // The raw token is in the email only — long and URL-safe.
      const token = /invite\/([A-Za-z0-9_-]+)/.exec(message.text)?.[1];
      expect(token?.length).toBeGreaterThanOrEqual(40);
    });

    it('a manager inviting a guest is denied', async () => {
      const { service } = makeService({
        ctx: { org: { ...ownerCtx.org, role: 'manager' } },
      });
      await expect(
        service.createInvite(USER, ORG, {
          email: 'g@example.com',
          role: 'guest',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('member invites into a personal org are rejected', async () => {
      const { service } = makeService({
        tables: {
          organizations: [{ data: orgRow({ type: 'personal' }), error: null }],
        },
        ctx: ownerCtx,
      });
      await expect(
        service.createInvite(USER, ORG, {
          email: 'a@example.com',
          role: 'member',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('the 50-pending cap is enforced', async () => {
      const { service } = makeService({
        tables: {
          organizations: [{ data: orgRow(), error: null }],
          organization_invites: [{ data: null, error: null, count: 50 }],
        },
        ctx: ownerCtx,
      });
      await expect(
        service.createInvite(USER, ORG, {
          email: 'a@example.com',
          role: 'member',
        }),
      ).rejects.toThrow('at most 50 pending invites');
    });

    it('a duplicate pending invite maps to 409', async () => {
      const { service } = makeService({
        tables: {
          organizations: [{ data: orgRow(), error: null }],
          organization_invites: [
            { data: null, error: null, count: 0 },
            { data: null, error: { code: '23505', message: 'dup' } },
          ],
        },
        ctx: ownerCtx,
      });
      await expect(
        service.createInvite(USER, ORG, {
          email: 'a@example.com',
          role: 'member',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps RPC accept errors to the documented statuses', async () => {
      const cases: Array<[string, unknown]> = [
        ['INVITE_NOT_FOUND', NotFoundException],
        ['INVITE_EXPIRED', ConflictException],
        ['INVITE_EMAIL_MISMATCH', ForbiddenException],
        ['ALREADY_FULL_MEMBER: user owns a company', ConflictException],
        ['PERSONAL_ORG_NOT_EMPTY: move things first', ConflictException],
      ];
      for (const [message, expected] of cases) {
        const { service } = makeService({
          rpc: jest.fn().mockResolvedValue({ data: null, error: { message } }),
        });
        await expect(
          service.acceptInvite(USER, 'raw-token'),
        ).rejects.toBeInstanceOf(expected as never);
      }
    });
  });

  describe('members', () => {
    const memberRows = [
      {
        user_id: USER.sub,
        role: 'owner',
        status: 'active',
        expires_at: null,
        created_at: 'x',
        suspended_at: null,
        profiles: { email: 'owner@example.com', full_name: 'Owner' },
      },
      {
        user_id: 'u-manager',
        role: 'manager',
        status: 'active',
        expires_at: null,
        created_at: 'x',
        suspended_at: null,
        profiles: { email: 'manager@example.com', full_name: 'Manager' },
      },
      {
        user_id: 'u-guest',
        role: 'guest',
        status: 'active',
        expires_at: null,
        created_at: 'x',
        suspended_at: null,
        profiles: { email: 'guest@example.com', full_name: 'Guest' },
      },
      {
        user_id: 'u-staff',
        role: 'guest',
        status: 'active',
        expires_at: null,
        created_at: 'x',
        suspended_at: null,
        profiles: { email: 'support@cropwatch.io', full_name: 'Support' },
      },
    ];

    it('the owner sees guests but never staff rows', async () => {
      const { service } = makeService({
        tables: { organization_members: [{ data: memberRows, error: null }] },
        ctx: ownerCtx,
      });
      const rows = await service.listMembers(USER, ORG);
      expect(rows.map((r) => r.email)).toEqual([
        'owner@example.com',
        'manager@example.com',
        'guest@example.com',
      ]);
    });

    it('a manager does not see guests', async () => {
      const { service } = makeService({
        tables: { organization_members: [{ data: memberRows, error: null }] },
        ctx: { org: { ...ownerCtx.org, role: 'manager' } },
      });
      const rows = await service.listMembers(USER, ORG);
      expect(rows.map((r) => r.role)).toEqual(['owner', 'manager']);
    });

    it('a member sees only themselves', async () => {
      const { service } = makeService({
        tables: { organization_members: [{ data: memberRows, error: null }] },
        ctx: { org: { ...ownerCtx.org, role: 'member' } },
      });
      const rows = await service.listMembers(USER, ORG);
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(USER.sub);
    });

    it('suspending a member also revokes the invites they sent', async () => {
      const { service, from } = makeService({
        tables: {
          organization_members: [
            {
              data: { user_id: 'u-member', role: 'member', status: 'active' },
              error: null,
            }, // loadMembership
            { data: null, error: null }, // status update
          ],
          organization_invites: [{ data: null, error: null }], // revoke update
        },
        ctx: ownerCtx,
      });
      await service.suspendMember(USER, ORG, 'u-member');
      expect(from.mock.calls.map(([t]: [string]) => t)).toEqual([
        'organization_members',
        'organization_members',
        'organization_invites',
      ]);
    });

    it('a manager suspending a manager is denied before any write', async () => {
      const { service, from } = makeService({
        tables: {
          organization_members: [
            {
              data: { user_id: 'u-2', role: 'manager', status: 'active' },
              error: null,
            },
          ],
        },
        ctx: { org: { ...ownerCtx.org, role: 'manager' } },
      });
      await expect(
        service.suspendMember(USER, ORG, 'u-2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(from).toHaveBeenCalledTimes(1); // the read only
    });
  });
});
