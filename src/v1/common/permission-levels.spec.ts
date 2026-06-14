import {
  canManage,
  canRead,
  isValidPermissionLevel,
  MANAGE_CEILING,
  MAX_PERMISSION_LEVEL,
  MIN_PERMISSION_LEVEL,
  PermissionLevel,
  READ_EXCLUSIVE_CEILING,
} from './permission-levels';

describe('permission-levels', () => {
  it('defines the 5-level model', () => {
    expect(PermissionLevel.ADMIN).toBe(1);
    expect(PermissionLevel.MANAGER).toBe(2);
    expect(PermissionLevel.USER).toBe(3);
    expect(PermissionLevel.VIEWER).toBe(4);
    expect(PermissionLevel.DISABLED).toBe(5);
    expect(MIN_PERMISSION_LEVEL).toBe(PermissionLevel.ADMIN);
    expect(MAX_PERMISSION_LEVEL).toBe(PermissionLevel.DISABLED);
    expect(READ_EXCLUSIVE_CEILING).toBe(PermissionLevel.DISABLED);
    expect(MANAGE_CEILING).toBe(PermissionLevel.MANAGER);
  });

  describe('canRead', () => {
    it('allows every level below DISABLED, including VIEWER', () => {
      expect(canRead(PermissionLevel.ADMIN)).toBe(true);
      expect(canRead(PermissionLevel.MANAGER)).toBe(true);
      expect(canRead(PermissionLevel.USER)).toBe(true);
      expect(canRead(PermissionLevel.VIEWER)).toBe(true);
    });

    it('denies DISABLED and missing levels', () => {
      expect(canRead(PermissionLevel.DISABLED)).toBe(false);
      expect(canRead(null)).toBe(false);
      expect(canRead(undefined)).toBe(false);
    });
  });

  describe('canManage', () => {
    it('allows ADMIN and MANAGER only', () => {
      expect(canManage(PermissionLevel.ADMIN)).toBe(true);
      expect(canManage(PermissionLevel.MANAGER)).toBe(true);
      expect(canManage(PermissionLevel.USER)).toBe(false);
      expect(canManage(PermissionLevel.VIEWER)).toBe(false);
      expect(canManage(PermissionLevel.DISABLED)).toBe(false);
      expect(canManage(null)).toBe(false);
      expect(canManage(undefined)).toBe(false);
    });
  });

  describe('isValidPermissionLevel', () => {
    it('accepts integers 1 through 5', () => {
      for (let level = 1; level <= 5; level++) {
        expect(isValidPermissionLevel(level)).toBe(true);
      }
    });

    it('rejects out-of-range and non-integer values', () => {
      expect(isValidPermissionLevel(0)).toBe(false);
      expect(isValidPermissionLevel(6)).toBe(false);
      expect(isValidPermissionLevel(2.5)).toBe(false);
      expect(isValidPermissionLevel(Number.NaN)).toBe(false);
    });
  });
});
