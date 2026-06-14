import { filterStaffOwnerRows, isStaffEmail } from './owner-filter.helper';

describe('owner-filter.helper', () => {
    const customerRow = {
        user_id: 'user-1',
        profiles: { email: 'farmer@example.com' },
    };
    const staffRow = {
        user_id: 'staff-1',
        profiles: { email: 'support@cropwatch.io' },
    };
    const staffRowMixedCase = {
        user_id: 'staff-2',
        profiles: { email: 'Kevin@CropWatch.IO ' },
    };
    const rowWithoutProfile = { user_id: 'user-2', profiles: null };

    describe('isStaffEmail', () => {
        it('matches the @cropwatch.io suffix case-insensitively', () => {
            expect(isStaffEmail('support@cropwatch.io')).toBe(true);
            expect(isStaffEmail('Kevin@CropWatch.IO')).toBe(true);
        });

        it('rejects non-staff and lookalike domains', () => {
            expect(isStaffEmail('farmer@example.com')).toBe(false);
            expect(isStaffEmail('attacker@notcropwatch.ioo')).toBe(false);
            expect(isStaffEmail('cropwatch.io@example.com')).toBe(false);
            expect(isStaffEmail(null)).toBe(false);
            expect(isStaffEmail(undefined)).toBe(false);
        });
    });

    describe('filterStaffOwnerRows', () => {
        it('hides staff rows from non-staff requesters', () => {
            const result = filterStaffOwnerRows(
                [customerRow, staffRow, staffRowMixedCase, rowWithoutProfile],
                false,
            );
            expect(result).toEqual([customerRow, rowWithoutProfile]);
        });

        it('returns all rows to staff requesters', () => {
            const rows = [customerRow, staffRow];
            expect(filterStaffOwnerRows(rows, true)).toEqual(rows);
        });

        it('handles array-shaped profile embeds', () => {
            const arrayProfileStaff = {
                user_id: 'staff-3',
                profiles: [{ email: 'ops@cropwatch.io' }],
            };
            expect(filterStaffOwnerRows([arrayProfileStaff], false)).toEqual([]);
        });

        it('tolerates null and undefined input', () => {
            expect(filterStaffOwnerRows(null, false)).toEqual([]);
            expect(filterStaffOwnerRows(undefined, true)).toEqual([]);
        });
    });
});
