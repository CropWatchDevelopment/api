import { BadRequestException } from '@nestjs/common';

/** A rule's planned start, planned pause, and the rule that takes over. */
export interface RuleAutoPlan {
  autoStartAt: string | null;
  autoPauseAt: string | null;
  chainTemplateId: number | null;
}

/** What a save asks for: `undefined` leaves a value as it is, `null` clears it. */
export interface RuleAutoPlanRequest {
  autoStartAt: string | null | undefined;
  autoPauseAt: string | null | undefined;
  onAutoPauseStartTemplateId: number | null | undefined;
}

/** The cw_rule_templates columns a save has to write (only the changed ones). */
export interface RuleAutoPlanUpdate {
  auto_start_at?: string | null;
  auto_pause_at?: string | null;
  on_auto_pause_start_template_id?: number | null;
}

export const NO_AUTO_PLAN: RuleAutoPlan = {
  autoStartAt: null,
  autoPauseAt: null,
  chainTemplateId: null,
};

// A date and time WITH a UTC offset. Without one, "09:00" would be read in the
// server's time zone instead of the user's.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Reads an instant from a request: undefined stays undefined (unchanged),
 * null or '' is null (clear), anything else must be ISO 8601 with an offset.
 */
export function normalizeInstant(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (
    typeof value !== 'string' ||
    !ISO_INSTANT.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new BadRequestException(
      `${label} must be a date and time with a UTC offset`,
    );
  }
  return new Date(value).toISOString();
}

export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/**
 * Merges a save into the rule's current plan and checks it.
 *
 * Only values that changed are returned for writing: a date the scheduler
 * used up while the form was open must not be written back, and an unchanged
 * date may already be a moment in the past.
 */
export function resolveAutoPlan(
  request: RuleAutoPlanRequest,
  current: RuleAutoPlan,
  now: number,
): { plan: RuleAutoPlan; update: RuleAutoPlanUpdate } {
  const autoStartAt =
    request.autoStartAt === undefined
      ? current.autoStartAt
      : request.autoStartAt;
  const autoPauseAt =
    request.autoPauseAt === undefined
      ? current.autoPauseAt
      : request.autoPauseAt;
  let chainTemplateId =
    request.onAutoPauseStartTemplateId === undefined
      ? current.chainTemplateId
      : request.onAutoPauseStartTemplateId;

  const startChanged = !sameInstant(autoStartAt, current.autoStartAt);
  const pauseChanged = !sameInstant(autoPauseAt, current.autoPauseAt);

  if (autoStartAt !== null && startChanged && Date.parse(autoStartAt) <= now) {
    throw new BadRequestException('The start date must be in the future');
  }
  if (autoPauseAt !== null && pauseChanged && Date.parse(autoPauseAt) <= now) {
    throw new BadRequestException('The pause date must be in the future');
  }
  if (autoStartAt !== null && sameInstant(autoStartAt, autoPauseAt)) {
    throw new BadRequestException(
      'The start date and the pause date cannot be the same',
    );
  }
  if (autoPauseAt === null) {
    if (typeof request.onAutoPauseStartTemplateId === 'number') {
      throw new BadRequestException(
        'Choose a pause date before choosing the rule to start after it',
      );
    }
    // The takeover belongs to the pause date and goes with it.
    chainTemplateId = null;
  }

  const update: RuleAutoPlanUpdate = {};
  if (startChanged) update.auto_start_at = autoStartAt;
  if (pauseChanged) update.auto_pause_at = autoPauseAt;
  if (chainTemplateId !== current.chainTemplateId) {
    update.on_auto_pause_start_template_id = chainTemplateId;
  }

  return { plan: { autoStartAt, autoPauseAt, chainTemplateId }, update };
}
