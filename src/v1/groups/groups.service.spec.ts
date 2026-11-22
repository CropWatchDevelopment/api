import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type {
  AccessService,
  AccessibleDevice,
  LocationAccess,
} from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { GroupsService } from './groups.service';

type QueryResult = { data: unknown; error: unknown };
type Chain = jest.Mock<Builder, unknown[]>;
interface Builder {
  data: unknown;
  error: unknown;
  select: Chain;
  eq: Chain;
  in: Chain;
  is: Chain;
  not: Chain;
  or: Chain;
  lt: Chain;
  lte: Chain;
  order: Chain;
  limit: Chain;
  range: Chain;
  insert: Chain;
  update: Chain;
  delete: Chain;
  maybeSingle: jest.Mock<Promise<QueryResult>, []>;
  single: jest.Mock<Promise<QueryResult>, []>;
}

/** A chainable PostgREST builder mock; awaiting it (or a terminal) gives `result`. */
const createBuilder = (result: QueryResult): Builder => {
  const builder: Builder = {
    data: result.data,
    error: result.error,
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => builder),
    not: jest.fn(() => builder),
    or: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    range: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    single: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
};

const ok = (data: unknown): Builder => createBuilder({ data, error: null });
const failed = (code = 'XX000'): Builder =>
  createBuilder({ data: null, error: { code, message: 'boom' } });

const createClient = (queues: Record<string, Builder[]>) => ({
  from: jest.fn((table: string): Builder => {
    const next = queues[table]?.shift();
    if (!next) {
      throw new Error(`No mock builder left for table: ${table}`);
    }
    return next;
  }),
});

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

const group = (
  id: number,
  name: string,
  orgId: string | null,
  createdBy: string | null,
) => ({ id, name, org_id: orgId, created_by: createdBy });

const accessible = (
  devEui: string,
  groupId: number | null,
  options: { orgId?: string; canView?: boolean; canManage?: boolean } = {},
): AccessibleDevice => ({
  devEui,
  name: devEui,
  orgId: options.orgId ?? ORG_A,
  groupId,
  permissionLevel: 4,
  canView: options.canView ?? true,
  canManage: options.canManage ?? false,
  canWriteNotes: false,
});

/** The access decision the location endpoints make: may edit, or not (suspended, Viewer, …). */
const locationAccess = (canEdit: boolean): LocationAccess => ({
  exists: true,
  locationId: 0,
  orgId: null,
  ownerId: null,
  canRead: true,
  isStaff: false,
  isOwner: false,
  level: canEdit ? 2 : 4,
  orgRole: null,
  parentRead: false,
});

const createService = (
  queues: Record<string, Builder[]>,
  options: {
    managed?: string[];
    readable?: string[];
    devices?: AccessibleDevice[];
    /** Whether the location endpoints would let the caller edit a location. */
    canEditLocation?: boolean;
  } = {},
) => {
  const client = createClient(queues);
  const accessService = {
    getReadableOrgIds: jest.fn().mockResolvedValue(options.readable ?? []),
    getManagedOrgIds: jest.fn().mockResolvedValue(options.managed ?? []),
    listAccessibleDevices: jest.fn().mockResolvedValue(options.devices ?? []),
    getLocationAccess: jest
      .fn()
      .mockResolvedValue(locationAccess(options.canEditLocation ?? false)),
  };
  const service = new GroupsService(
    { getClient: jest.fn(() => client) } as unknown as SupabaseService,
    accessService as unknown as AccessService,
  );
  return { service, client, accessService };
};

const USER: AuthenticatedUser = {
  sub: 'user-1',
  email: 'farmer@example.com',
  isStaff: false,
};
const STAFF: AuthenticatedUser = {
  sub: 'staff-1',
  email: 'support@cropwatch.io',
  isStaff: true,
};

describe('GroupsService', () => {
  describe('list', () => {
    it('gives staff every group (of one org when asked), managing all of them', async () => {
      const all = ok([
        group(2, 'Barn', ORG_A, 'someone'),
        group(1, 'Annex', ORG_A, null),
      ]);
      const { service } = createService({ cw_location_groups: [all] });

      await expect(
        service.list('location', STAFF, { orgId: ORG_A, locale: 'en' }),
      ).resolves.toEqual([
        { id: 1, name: 'Annex', org_id: ORG_A, can_manage: true },
        { id: 2, name: 'Barn', org_id: ORG_A, can_manage: true },
      ]);
      expect(all.eq).toHaveBeenCalledWith('org_id', ORG_A);
    });

    it('gives a user the groups on locations they read, of orgs they manage, and their unused ones', async () => {
      const attached = ok([{ group_id: 5 }, { group_id: 9 }]);
      const own = ok([
        group(3, 'Mine, unused', ORG_B, 'user-1'),
        group(4, 'Mine, used elsewhere', ORG_B, 'user-1'),
      ]);
      const managedOrg = ok([group(7, 'Org group', ORG_A, 'colleague')]);
      const usage = ok([{ group_id: 4 }]);
      const others = ok([
        group(5, 'Shared', ORG_B, 'colleague'),
        group(9, 'Org attached', ORG_A, 'colleague'),
      ]);
      // The user can still edit a location of ORG_B, where their unused group is.
      const editable = ok([{ location_id: 40, org_id: ORG_B }]);
      const { service, accessService } = createService(
        {
          cw_locations: [attached, usage, editable],
          cw_location_groups: [own, managedOrg, others],
        },
        { managed: [ORG_A], canEditLocation: true },
      );

      await expect(
        service.list('location', USER, { locale: 'en' }),
      ).resolves.toEqual([
        { id: 3, name: 'Mine, unused', org_id: ORG_B, can_manage: true },
        { id: 9, name: 'Org attached', org_id: ORG_A, can_manage: true },
        { id: 7, name: 'Org group', org_id: ORG_A, can_manage: true },
        { id: 5, name: 'Shared', org_id: ORG_B, can_manage: false },
      ]);
      // The attached groups come from the shared read scope (one eq + one or)…
      expect(attached.not).toHaveBeenCalledWith('group_id', 'is', null);
      expect(attached.eq).toHaveBeenCalledTimes(1);
      expect(attached.or).toHaveBeenCalledTimes(1);
      // …the managed org's groups by org, own groups by creator…
      expect(own.eq).toHaveBeenCalledWith('created_by', 'user-1');
      expect(managedOrg.in).toHaveBeenCalledWith('org_id', [ORG_A]);
      // …and a group the user created but that sits only on locations they
      // can no longer read (id 4) stays hidden.
      expect(usage.in).toHaveBeenCalledWith('group_id', [3, 4]);
      expect(others.in).toHaveBeenCalledWith('id', [5, 9]);
      // Edit rights are confirmed with the location endpoints' own decision.
      expect(accessService.getLocationAccess).toHaveBeenCalledWith(USER, 40);
    });

    it('hides a creator’s unused group once they can edit nothing in its org', async () => {
      const own = ok([group(3, 'Mine, unused', ORG_B, 'user-1')]);
      const { service } = createService(
        {
          cw_locations: [
            ok([]),
            ok([]),
            // Still listed by the scope, but suspended: the location
            // endpoints would refuse the edit.
            ok([{ location_id: 40, org_id: ORG_B }]),
          ],
          cw_location_groups: [own],
        },
        { canEditLocation: false },
      );

      await expect(service.list('location', USER)).resolves.toEqual([]);
    });

    it('shows parent-org readers the groups on the child orgs’ locations', async () => {
      const attached = ok([{ group_id: 6 }]);
      const { service } = createService(
        {
          cw_locations: [attached],
          cw_location_groups: [ok([]), ok([group(6, 'Child', ORG_B, 'x')])],
        },
        { readable: [ORG_B] },
      );

      await expect(service.list('location', USER)).resolves.toEqual([
        { id: 6, name: 'Child', org_id: ORG_B, can_manage: false },
      ]);
      expect(attached.or).toHaveBeenCalledWith(
        expect.stringContaining(`org_id.in.(${ORG_B})`),
      );
    });

    it('keeps only the asked org’s groups', async () => {
      const own = ok([]);
      const others = ok([
        group(5, 'Shared', ORG_B, 'colleague'),
        group(9, 'Other org', ORG_A, 'colleague'),
      ]);
      const { service } = createService({
        cw_locations: [ok([{ group_id: 5 }, { group_id: 9 }])],
        cw_location_groups: [own, others],
      });

      await expect(
        service.list('location', USER, { orgId: ORG_B }),
      ).resolves.toEqual([
        { id: 5, name: 'Shared', org_id: ORG_B, can_manage: false },
      ]);
      expect(own.eq).toHaveBeenCalledWith('org_id', ORG_B);
    });

    it('uses the devices the user can view for device groups', async () => {
      const others = ok([group(9, 'Sensors', ORG_A, 'colleague')]);
      const { service, accessService } = createService(
        { cw_device_groups: [ok([]), others] },
        {
          devices: [
            accessible('VIEW', 9),
            accessible('NO-GROUP', null),
            accessible('DISABLED', 11, { canView: false }),
          ],
        },
      );

      await expect(service.list('device', USER)).resolves.toEqual([
        { id: 9, name: 'Sensors', org_id: ORG_A, can_manage: false },
      ]);
      expect(accessService.listAccessibleDevices).toHaveBeenCalledWith(USER);
      // A Disabled device does not reveal its group.
      expect(others.in).toHaveBeenCalledWith('id', [9]);
    });

    it('fails with 500 when a lookup fails', async () => {
      const { service } = createService({ cw_locations: [failed()] });
      await expect(service.list('location', USER)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );

      const { service: second } = createService({
        cw_location_groups: [failed()],
      });
      await expect(second.list('location', STAFF)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('create', () => {
    it('adds a group to an org the caller manages', async () => {
      const lookup = ok(null);
      const insert = ok(group(7, 'Barn', ORG_A, 'user-1'));
      const { service } = createService(
        { cw_device_groups: [lookup, insert] },
        { managed: [ORG_A] },
      );

      await expect(
        service.create('device', USER, '  Barn ', ORG_A),
      ).resolves.toEqual({
        id: 7,
        name: 'Barn',
        org_id: ORG_A,
        can_manage: true,
      });
      expect(lookup.eq).toHaveBeenCalledWith('name', 'Barn');
      expect(lookup.eq).toHaveBeenCalledWith('org_id', ORG_A);
      expect(insert.insert).toHaveBeenCalledWith({
        org_id: ORG_A,
        name: 'Barn',
        created_by: 'user-1',
      });
    });

    it('returns the org’s existing group of that name instead of a duplicate', async () => {
      const lookup = ok(group(3, 'Barn', ORG_A, 'colleague'));
      const { service } = createService({ cw_location_groups: [lookup] });

      await expect(
        service.create('location', STAFF, 'Barn', ORG_A),
      ).resolves.toEqual({
        id: 3,
        name: 'Barn',
        org_id: ORG_A,
        can_manage: true,
      });
      expect(lookup.insert).not.toHaveBeenCalled();
    });

    it('lets whoever can edit one of the org’s locations add a group', async () => {
      const manageable = ok([{ location_id: 8, org_id: ORG_A }]);
      const { service, accessService } = createService(
        {
          cw_locations: [manageable, ok([])],
          cw_location_groups: [ok(null), ok(group(8, 'Barn', ORG_A, 'user-1'))],
        },
        { canEditLocation: true },
      );

      await expect(
        service.create('location', USER, 'Barn', ORG_A),
      ).resolves.toMatchObject({ id: 8, can_manage: true });
      expect(manageable.eq).toHaveBeenCalledWith('org_id', ORG_A);
      // Manage scope: the owner-row match plus Admin/Manager levels…
      expect(manageable.lte).toHaveBeenCalledTimes(1);
      // …confirmed with the location endpoints' own decision.
      expect(accessService.getLocationAccess).toHaveBeenCalledWith(USER, 8);
    });

    it('refuses a member the location endpoints would refuse (suspended, Viewer)', async () => {
      const { service, client } = createService(
        { cw_locations: [ok([{ location_id: 8, org_id: ORG_A }])] },
        { canEditLocation: false },
      );

      await expect(
        service.create('location', USER, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.from).not.toHaveBeenCalledWith('cw_location_groups');
    });

    it('does not let device rights in one org add device groups to another', async () => {
      const { service } = createService(
        { cw_locations: [ok([])] },
        {
          devices: [
            accessible('MINE', null, { orgId: ORG_B, canManage: true }),
          ],
        },
      );

      await expect(
        service.create('device', USER, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 404 for an organization that does not exist', async () => {
      const { service } = createService({
        cw_device_groups: [ok(null), failed('23503')],
      });
      await expect(
        service.create('device', STAFF, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets whoever can edit one of the org’s devices add a device group', async () => {
      const { service } = createService(
        {
          cw_device_groups: [ok(null), ok(group(8, 'Barn', ORG_A, 'user-1'))],
        },
        { devices: [accessible('MINE', null, { canManage: true })] },
      );

      await expect(
        service.create('device', USER, 'Barn', ORG_A),
      ).resolves.toMatchObject({ id: 8 });
    });

    it('refuses everyone else before writing anything', async () => {
      const { service, client } = createService(
        { cw_locations: [ok([])] },
        { devices: [accessible('VIEW-ONLY', null, { orgId: ORG_A })] },
      );

      await expect(
        service.create('device', USER, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.from).not.toHaveBeenCalledWith('cw_device_groups');
    });

    it('takes the group a concurrent request just added', async () => {
      const { service } = createService({
        cw_device_groups: [
          ok(null),
          failed('23505'),
          ok(group(9, 'Barn', ORG_A, 'other')),
        ],
      });
      await expect(
        service.create('device', STAFF, 'Barn', ORG_A),
      ).resolves.toMatchObject({ id: 9 });
    });

    it('answers 400 for a blank name and 500 when the insert fails', async () => {
      const { service } = createService({
        cw_device_groups: [
          ok(null),
          failed(),
          ok(null),
          failed('23505'),
          ok(null),
        ],
      });
      await expect(
        service.create('device', STAFF, '   ', ORG_A),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create('device', STAFF, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(
        service.create('device', STAFF, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('fails with 500 when the edit-right check fails', async () => {
      const { service } = createService({ cw_locations: [failed()] });
      await expect(
        service.create('location', USER, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('rename and remove', () => {
    it('lets an owner/manager of the org rename anyone’s group', async () => {
      const update = ok(group(5, 'New', ORG_A, 'colleague'));
      const { service } = createService(
        {
          cw_location_groups: [
            ok([group(5, 'Old', ORG_A, 'colleague')]),
            update,
          ],
          cw_locations: [ok([])],
        },
        { managed: [ORG_A] },
      );

      await expect(
        service.rename('location', USER, 5, ' New '),
      ).resolves.toEqual({
        id: 5,
        name: 'New',
        org_id: ORG_A,
        can_manage: true,
      });
      expect(update.update).toHaveBeenCalledWith({
        name: 'New',
        updated_at: expect.any(String) as string,
      });
      expect(update.eq).toHaveBeenCalledWith('id', 5);
    });

    it('lets the creator change a group they can still see', async () => {
      const del = ok(null);
      const { service } = createService({
        cw_location_groups: [ok([group(5, 'Mine', ORG_A, 'user-1')]), del],
        // Attached to a location the creator can read.
        cw_locations: [ok([{ group_id: 5 }])],
      });

      await expect(
        service.remove('location', USER, 5),
      ).resolves.toBeUndefined();
      expect(del.delete).toHaveBeenCalled();
      expect(del.eq).toHaveBeenCalledWith('id', 5);
    });

    it('lets the creator change their unused group', async () => {
      const { service } = createService(
        {
          cw_location_groups: [
            ok([group(5, 'Mine', ORG_A, 'user-1')]),
            ok(group(5, 'Renamed', ORG_A, 'user-1')),
          ],
          cw_locations: [
            ok([]),
            ok([]),
            ok([{ location_id: 8, org_id: ORG_A }]),
          ],
        },
        { canEditLocation: true },
      );

      await expect(
        service.rename('location', USER, 5, 'Renamed'),
      ).resolves.toMatchObject({ name: 'Renamed', can_manage: true });
    });

    it('hides an unused group whose creator can no longer edit in its org (404)', async () => {
      const { service } = createService(
        {
          cw_location_groups: [ok([group(5, 'Mine', ORG_A, 'user-1')])],
          cw_locations: [ok([]), ok([]), ok([])],
        },
        { canEditLocation: false },
      );

      await expect(
        service.rename('location', USER, 5, 'Probe'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not let a manager of one org change another org’s groups', async () => {
      const { service } = createService(
        {
          cw_location_groups: [ok([group(5, 'Theirs', ORG_A, 'stranger')])],
          cw_locations: [ok([])],
        },
        { managed: [ORG_B] },
      );

      await expect(service.remove('location', USER, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hides a group whose creator lost access to everything using it (404)', async () => {
      const { service } = createService({
        cw_location_groups: [ok([group(5, 'Mine', ORG_A, 'user-1')])],
        cw_locations: [ok([]), ok([{ group_id: 5 }])],
      });

      await expect(service.remove('location', USER, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers 403 when the user sees the group but may not change it', async () => {
      const { service } = createService({
        cw_location_groups: [ok([group(5, 'Theirs', ORG_A, 'colleague')])],
        cw_locations: [ok([{ group_id: 5 }])],
      });
      await expect(
        service.rename('location', USER, 5, 'New'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 404 for a group the user cannot see or that does not exist', async () => {
      const { service } = createService(
        {
          cw_device_groups: [
            ok([group(5, 'Stranger', ORG_B, 'stranger')]),
            ok([]),
          ],
        },
        { devices: [accessible('OTHER', 8)] },
      );
      await expect(service.remove('device', USER, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove('device', USER, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lets staff rename and delete any group', async () => {
      const { service } = createService({
        cw_location_groups: [
          ok([group(5, 'Old', ORG_A, 'someone')]),
          ok(group(5, 'New', ORG_A, 'someone')),
          ok([group(5, 'New', ORG_A, 'someone')]),
          ok(null),
        ],
      });

      await expect(
        service.rename('location', STAFF, 5, 'New'),
      ).resolves.toMatchObject({ can_manage: true });
      await expect(
        service.remove('location', STAFF, 5),
      ).resolves.toBeUndefined();
    });

    it('answers 409 when the org already has the new name', async () => {
      const { service } = createService({
        cw_location_groups: [
          ok([group(5, 'Old', ORG_A, 'x')]),
          failed('23505'),
        ],
      });
      await expect(
        service.rename('location', STAFF, 5, 'Taken'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('answers 404 when the group vanished before the rename, 400/500 otherwise', async () => {
      const { service } = createService({
        cw_location_groups: [
          ok([group(5, 'Old', ORG_A, 'x')]),
          ok(null),
          ok([group(5, 'Old', ORG_A, 'x')]),
          failed(),
          ok([group(5, 'Old', ORG_A, 'x')]),
          failed(),
        ],
      });
      await expect(
        service.rename('location', STAFF, 5, 'New'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.rename('location', STAFF, 5, 'New'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(service.remove('location', STAFF, 5)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      await expect(
        service.rename('location', STAFF, 5, '  '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveForWrite', () => {
    it('means "no group" for an empty or missing name', async () => {
      const { service, client } = createService({});
      for (const name of [undefined, null, '', '   ']) {
        await expect(
          service.resolveForWrite('location', USER, name, ORG_A),
        ).resolves.toBeNull();
      }
      expect(client.from).not.toHaveBeenCalled();
    });

    it('leaves name length to the endpoints’ validators (they count emoji their own way)', async () => {
      const emoji = '🌱'.repeat(61); // 122 UTF-16 units, 61 characters to class-validator
      const lookup = ok(group(4, emoji, ORG_A, 'a'));
      const { service } = createService({ cw_device_groups: [lookup] });

      await expect(
        service.resolveForWrite('device', USER, emoji, ORG_A),
      ).resolves.toBe(4);
    });

    it('answers 400 for a name the table refuses', async () => {
      const { service } = createService({
        cw_device_groups: [ok(null), failed('23514')],
        cw_location_groups: [
          ok([group(5, 'Old', ORG_A, 'x')]),
          failed('23514'),
        ],
      });
      await expect(
        service.resolveForWrite('device', USER, 'Odd', ORG_A),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.rename('location', STAFF, 5, 'Odd'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the org’s group of that name, whoever created it', async () => {
      const lookup = ok(group(12, 'Barn', ORG_A, 'colleague'));
      const { service } = createService({ cw_location_groups: [lookup] });

      await expect(
        service.resolveForWrite('location', USER, ' Barn ', ORG_A),
      ).resolves.toBe(12);
      expect(lookup.eq).toHaveBeenCalledWith('name', 'Barn');
      expect(lookup.eq).toHaveBeenCalledWith('org_id', ORG_A);
      expect(lookup.insert).not.toHaveBeenCalled();
    });

    it('adds the group to the org when it has none of that name', async () => {
      const insert = ok({ id: 30 });
      const { service } = createService({
        cw_device_groups: [ok(null), insert],
      });

      await expect(
        service.resolveForWrite('device', USER, 'Fresh', ORG_B),
      ).resolves.toBe(30);
      expect(insert.insert).toHaveBeenCalledWith({
        org_id: ORG_B,
        name: 'Fresh',
        created_by: 'user-1',
      });
    });

    it('matches org-less resources on the org-less group', async () => {
      const lookup = ok(group(2, 'Loose', null, 'a'));
      const { service } = createService({ cw_device_groups: [lookup] });

      await expect(
        service.resolveForWrite('device', USER, 'Loose', null),
      ).resolves.toBe(2);
      expect(lookup.is).toHaveBeenCalledWith('org_id', null);
    });

    it('takes the group a concurrent request just created', async () => {
      const { service } = createService({
        cw_device_groups: [
          ok(null),
          failed('23505'),
          ok(group(31, 'Fresh', ORG_A, 'other')),
        ],
      });
      await expect(
        service.resolveForWrite('device', USER, 'Fresh', ORG_A),
      ).resolves.toBe(31);
    });

    it('fails with 500 when a lookup or the insert fails', async () => {
      const { service } = createService({
        cw_location_groups: [failed(), ok(null), failed()],
      });
      await expect(
        service.resolveForWrite('location', USER, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(
        service.resolveForWrite('location', USER, 'Barn', ORG_A),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});
