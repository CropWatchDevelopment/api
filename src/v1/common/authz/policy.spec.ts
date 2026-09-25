import { PermissionLevel } from '../permission-levels';
import { Action } from './actions';
import {
  POLICY_CEILINGS,
  type AccessSubject,
  capabilitiesFor,
  decide,
} from './policy';

const subject = (
  level: number | null,
  overrides: Partial<AccessSubject> = {},
): AccessSubject => ({ isStaff: false, isOwner: false, level, ...overrides });

describe('POLICY_CEILINGS', () => {
  it('covers every action exactly once', () => {
    expect(Object.keys(POLICY_CEILINGS).sort()).toEqual(
      Object.values(Action).sort(),
    );
  });

  it('keeps today’s thresholds (docs/permission-model.md)', () => {
    expect(POLICY_CEILINGS[Action.DeviceRead]).toBe(PermissionLevel.VIEWER);
    expect(POLICY_CEILINGS[Action.DeviceEdit]).toBe(PermissionLevel.MANAGER);
    expect(POLICY_CEILINGS[Action.DeviceGrant]).toBe(PermissionLevel.ADMIN);
    expect(POLICY_CEILINGS[Action.RuleManage]).toBe(PermissionLevel.MANAGER);
    expect(POLICY_CEILINGS[Action.ReportManage]).toBe(PermissionLevel.MANAGER);
    expect(POLICY_CEILINGS[Action.RelayControl]).toBe(PermissionLevel.MANAGER);
    // Notes are a write: User and above, not Viewers (security defect #6).
    expect(POLICY_CEILINGS[Action.NoteWrite]).toBe(PermissionLevel.USER);
    // Adding a device to a location is a location-manage action (bug fix:
    // previously required the literal location owner).
    expect(POLICY_CEILINGS[Action.LocationDeviceCreate]).toBe(
      PermissionLevel.MANAGER,
    );
  });
});

describe('decide', () => {
  // persona -> expected allowed actions, table-driven over every action
  const personas: Array<{
    name: string;
    subject: AccessSubject;
    allowed: (action: Action) => boolean;
  }> = [
    {
      name: 'staff',
      subject: subject(null, { isStaff: true }),
      allowed: () => true,
    },
    {
      name: 'implicit owner',
      subject: subject(null, { isOwner: true }),
      allowed: () => true,
    },
    {
      name: 'admin (1)',
      subject: subject(PermissionLevel.ADMIN),
      allowed: () => true,
    },
    {
      name: 'manager (2)',
      subject: subject(PermissionLevel.MANAGER),
      allowed: (action) => POLICY_CEILINGS[action] >= PermissionLevel.MANAGER,
    },
    {
      name: 'user (3)',
      subject: subject(PermissionLevel.USER),
      allowed: (action) => POLICY_CEILINGS[action] >= PermissionLevel.USER,
    },
    {
      name: 'viewer (4)',
      subject: subject(PermissionLevel.VIEWER),
      allowed: (action) => POLICY_CEILINGS[action] >= PermissionLevel.VIEWER,
    },
    {
      name: 'disabled (5)',
      subject: subject(PermissionLevel.DISABLED),
      allowed: () => false,
    },
    { name: 'no relationship', subject: subject(null), allowed: () => false },
  ];

  for (const persona of personas) {
    it(`resolves every action for ${persona.name}`, () => {
      for (const action of Object.values(Action)) {
        expect({ action, allowed: decide(persona.subject, action) }).toEqual({
          action,
          allowed: persona.allowed(action),
        });
      }
    });
  }

  it('denies specific sensitive actions at the right boundaries', () => {
    // A Manager cannot change device permissions (Admin-only).
    expect(decide(subject(PermissionLevel.MANAGER), Action.DeviceGrant)).toBe(
      false,
    );
    // A User cannot control relays or manage rules.
    expect(decide(subject(PermissionLevel.USER), Action.RelayControl)).toBe(
      false,
    );
    expect(decide(subject(PermissionLevel.USER), Action.RuleManage)).toBe(
      false,
    );
    // A Viewer cannot write notes (defect #6) but can read data.
    expect(decide(subject(PermissionLevel.VIEWER), Action.NoteWrite)).toBe(
      false,
    );
    expect(decide(subject(PermissionLevel.VIEWER), Action.DataRead)).toBe(true);
  });
});

describe('capabilitiesFor', () => {
  it('is empty for disabled users and full for staff', () => {
    expect(capabilitiesFor(subject(PermissionLevel.DISABLED))).toEqual([]);
    expect(capabilitiesFor(subject(null, { isStaff: true }))).toEqual(
      Object.values(Action),
    );
  });

  it('gives viewers exactly the read tier', () => {
    const caps = capabilitiesFor(subject(PermissionLevel.VIEWER));
    expect(caps).toContain(Action.DeviceRead);
    expect(caps).toContain(Action.ReportDownload);
    expect(caps).not.toContain(Action.NoteWrite);
    expect(caps).not.toContain(Action.DeviceEdit);
  });
});
