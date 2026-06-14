const STAFF_EMAIL_SUFFIX = '@cropwatch.io';

interface OwnerRowWithProfile {
    profiles?: { email?: string | null } | { email?: string | null }[] | null;
}

export function isStaffEmail(email: string | null | undefined): boolean {
    return (
        typeof email === 'string' &&
        email.trim().toLowerCase().endsWith(STAFF_EMAIL_SUFFIX)
    );
}

function rowHasStaffProfile(row: OwnerRowWithProfile): boolean {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return isStaffEmail(profile?.email);
}

/**
 * Hides CropWatch staff permission rows from non-staff requesters.
 *
 * Staff accounts (emails ending in @cropwatch.io) routinely hold support
 * access to customer locations; customers must not see them in user lists.
 * This must happen server-side — client-side hiding still leaks the rows in
 * the API response.
 */
export function filterStaffOwnerRows<T extends OwnerRowWithProfile>(
    rows: T[] | null | undefined,
    requesterIsStaff: boolean,
): T[] {
    const safeRows = rows ?? [];
    if (requesterIsStaff) {
        return safeRows;
    }
    return safeRows.filter((row) => !rowHasStaffProfile(row));
}
