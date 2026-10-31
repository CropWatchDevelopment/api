import { isStaffEmail } from './owner-filter.helper';

/*
 * CropWatch staff stay on customers' notes, report recipients and alert
 * recipients for monitoring and QA, but customers must never see a staff
 * address (same rule as filterStaffOwnerRows). Responses to non-staff drop
 * the staff part; a customer's save puts it back, so editing a report or a
 * rule never unsubscribes staff.
 */

/** Rows whose `email` is a staff address, hidden from non-staff requesters. */
export function withoutStaffEmails<T extends { email?: string | null }>(
  rows: T[],
  requesterIsStaff: boolean,
): T[] {
  if (requesterIsStaff) return rows;
  return rows.filter((row) => !isStaffEmail(row.email));
}

/**
 * A note's author email (`created_by`) blanked for non-staff when a staff
 * member wrote it. `created_by_staff` lets the app say who wrote it instead.
 */
export function hideStaffAuthor<T extends { created_by?: string | null }>(
  note: T,
  requesterIsStaff: boolean,
): T & { created_by_staff: boolean } {
  const byStaff = isStaffEmail(note.created_by);
  return {
    ...note,
    created_by: byStaff && !requesterIsStaff ? null : note.created_by,
    created_by_staff: byStaff,
  };
}

/** hideStaffAuthor over the notes air data rows embed (`cw_air_annotations`). */
export function hideStaffAuthorsInRows<T>(
  rows: T[],
  requesterIsStaff: boolean,
): T[] {
  return rows.map((row) => {
    const notes = (row as { cw_air_annotations?: unknown }).cw_air_annotations;
    if (!Array.isArray(notes)) return row;
    return {
      ...row,
      cw_air_annotations: notes.map((note: { created_by?: string | null }) =>
        hideStaffAuthor(note, requesterIsStaff),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Rule action recipients
// ---------------------------------------------------------------------------

/**
 * How an action type addresses people in `config.recipient`: EMail holds a
 * comma-separated address list, LINE and Push a JSON `{"userIds":[...]}`.
 * Other types (LoRaWAN relay commands) address no one.
 */
export type RuleRecipientKind = 'email' | 'userIds';

export function ruleRecipientKind(
  actionTypeName: string | null | undefined,
): RuleRecipientKind | null {
  switch (actionTypeName) {
    case 'EMail':
      return 'email';
    case 'LINE':
    case 'Push':
      return 'userIds';
    default:
      return null;
  }
}

function readRecipientText(config: unknown): string {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return '';
  const recipient = (config as Record<string, unknown>).recipient;
  return typeof recipient === 'string' ? recipient : '';
}

/** The people an action's config addresses; [] when it addresses no one. */
export function readRuleRecipients(
  kind: RuleRecipientKind,
  config: unknown,
): string[] {
  const text = readRecipientText(config);
  if (kind === 'email') {
    return text
      .split(/[,;]/)
      .map((address) => address.trim())
      .filter((address) => address.length > 0);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const userIds = (parsed as { userIds?: unknown } | null)?.userIds;
    return Array.isArray(userIds)
      ? userIds.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

/** The config with its recipients replaced, every other key kept. */
export function writeRuleRecipients<T>(
  kind: RuleRecipientKind,
  config: T,
  recipients: string[],
): T {
  const base =
    config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return {
    ...base,
    recipient:
      kind === 'email'
        ? recipients.join(', ')
        : JSON.stringify({ userIds: recipients }),
  } as T;
}

/** The config with `extra` recipients appended, skipping ones it already has. */
export function addRuleRecipients<T>(
  kind: RuleRecipientKind,
  config: T,
  extra: string[],
): T {
  // Addresses compare case-insensitively; user ids exactly.
  const key = (recipient: string) =>
    kind === 'email' ? recipient.toLowerCase() : recipient;
  const recipients = readRuleRecipients(kind, config);
  const seen = new Set(recipients.map(key));
  for (const recipient of extra) {
    if (seen.has(key(recipient))) continue;
    seen.add(key(recipient));
    recipients.push(recipient);
  }
  return writeRuleRecipients(kind, config, recipients);
}

/**
 * Splits an action's recipients into the ones a customer may see and the
 * staff ones. `isStaffRecipient` decides per address or user id.
 */
export function splitStaffRecipients(
  kind: RuleRecipientKind,
  config: unknown,
  isStaffRecipient: (recipient: string) => boolean,
): { visible: string[]; staff: string[] } {
  const visible: string[] = [];
  const staff: string[] = [];
  for (const recipient of readRuleRecipients(kind, config)) {
    (isStaffRecipient(recipient) ? staff : visible).push(recipient);
  }
  return { visible, staff };
}
