import { BadRequestException } from '@nestjs/common';
import {
  NO_AUTO_PLAN,
  normalizeInstant,
  resolveAutoPlan,
  sameInstant,
  type RuleAutoPlan,
  type RuleAutoPlanRequest,
} from './rule-auto-plan';

const NOW = Date.parse('2026-11-27T03:00:00Z');
const PAST = '2026-11-27T02:59:00.000Z';
const SOON = '2026-11-27T03:05:00.000Z';
const LATER = '2026-12-24T00:00:00.000Z';

const request = (
  overrides: Partial<RuleAutoPlanRequest> = {},
): RuleAutoPlanRequest => ({
  autoStartAt: undefined,
  autoPauseAt: undefined,
  onAutoPauseStartTemplateId: undefined,
  ...overrides,
});

const plan = (overrides: Partial<RuleAutoPlan> = {}): RuleAutoPlan => ({
  ...NO_AUTO_PLAN,
  ...overrides,
});

describe('normalizeInstant', () => {
  it('keeps "not sent" and "clear" apart', () => {
    expect(normalizeInstant(undefined, 'The start date')).toBeUndefined();
    expect(normalizeInstant(null, 'The start date')).toBeNull();
    expect(normalizeInstant('', 'The start date')).toBeNull();
  });

  it('reads an instant with an offset as UTC', () => {
    expect(normalizeInstant('2026-12-01T09:00:00+09:00', 'x')).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(normalizeInstant('2026-12-01T09:00Z', 'x')).toBe(
      '2026-12-01T09:00:00.000Z',
    );
    expect(normalizeInstant('2026-12-01T09:00:00.250-05:00', 'x')).toBe(
      '2026-12-01T14:00:00.250Z',
    );
  });

  it.each([
    ['a local time without an offset', '2026-12-01T09:00:00'],
    ['a date without a time', '2026-12-01'],
    ['words', 'tomorrow'],
    ['a date that does not exist', '2026-13-45T09:00:00Z'],
    ['a number', 1796000000000],
  ])('refuses %s', (_name, value) => {
    expect(() => normalizeInstant(value, 'The pause date')).toThrow(
      new BadRequestException(
        'The pause date must be a date and time with a UTC offset',
      ),
    );
  });
});

describe('sameInstant', () => {
  it('compares moments, not spellings', () => {
    expect(sameInstant(null, null)).toBe(true);
    expect(sameInstant(null, SOON)).toBe(false);
    expect(sameInstant(SOON, null)).toBe(false);
    expect(
      sameInstant('2026-12-01T09:00:00+09:00', '2026-12-01T00:00:00Z'),
    ).toBe(true);
    expect(sameInstant(SOON, LATER)).toBe(false);
  });
});

describe('resolveAutoPlan', () => {
  it('changes nothing when nothing is sent', () => {
    const current = plan({
      autoStartAt: SOON,
      autoPauseAt: LATER,
      chainTemplateId: 4,
    });
    expect(resolveAutoPlan(request(), current, NOW)).toEqual({
      plan: current,
      update: {},
    });
  });

  it('writes only what changed', () => {
    const result = resolveAutoPlan(
      request({ autoStartAt: SOON, autoPauseAt: LATER }),
      plan({ autoStartAt: SOON }),
      NOW,
    );
    expect(result.update).toEqual({ auto_pause_at: LATER });
    expect(result.plan).toEqual(
      plan({ autoStartAt: SOON, autoPauseAt: LATER }),
    );
  });

  it('does not write back a stored date that is spelled differently', () => {
    const result = resolveAutoPlan(
      request({ autoStartAt: '2026-11-27T03:05:00.000Z' }),
      plan({ autoStartAt: '2026-11-27T12:05:00+09:00' }),
      NOW,
    );
    expect(result.update).toEqual({});
  });

  it('accepts a stored date that has just passed, and leaves it to the scheduler', () => {
    const result = resolveAutoPlan(
      request({ autoStartAt: PAST, autoPauseAt: PAST.replace(':59:', ':58:') }),
      plan({ autoStartAt: PAST, autoPauseAt: PAST.replace(':59:', ':58:') }),
      NOW,
    );
    expect(result.update).toEqual({});
  });

  it('refuses a new date that is not in the future', () => {
    expect(() =>
      resolveAutoPlan(request({ autoStartAt: PAST }), plan(), NOW),
    ).toThrow(new BadRequestException('The start date must be in the future'));
    expect(() =>
      resolveAutoPlan(
        request({ autoPauseAt: new Date(NOW).toISOString() }),
        plan({ autoPauseAt: LATER }),
        NOW,
      ),
    ).toThrow(new BadRequestException('The pause date must be in the future'));
  });

  it('refuses a start date and a pause date at the same moment', () => {
    expect(() =>
      resolveAutoPlan(
        request({ autoStartAt: SOON }),
        plan({ autoPauseAt: SOON }),
        NOW,
      ),
    ).toThrow(
      new BadRequestException(
        'The start date and the pause date cannot be the same',
      ),
    );
  });

  it('allows the pause date before the start date (pause, then start again)', () => {
    const result = resolveAutoPlan(
      request({ autoPauseAt: SOON, autoStartAt: LATER }),
      plan(),
      NOW,
    );
    expect(result.update).toEqual({
      auto_pause_at: SOON,
      auto_start_at: LATER,
    });
  });

  it('clears dates with null', () => {
    const result = resolveAutoPlan(
      request({ autoStartAt: null }),
      plan({ autoStartAt: SOON, autoPauseAt: LATER, chainTemplateId: 4 }),
      NOW,
    );
    expect(result.update).toEqual({ auto_start_at: null });
    expect(result.plan.chainTemplateId).toBe(4);
  });

  it('sets, changes and clears the rule that takes over', () => {
    const current = plan({ autoPauseAt: LATER });
    expect(
      resolveAutoPlan(request({ onAutoPauseStartTemplateId: 4 }), current, NOW)
        .update,
    ).toEqual({ on_auto_pause_start_template_id: 4 });
    expect(
      resolveAutoPlan(
        request({ onAutoPauseStartTemplateId: null }),
        { ...current, chainTemplateId: 4 },
        NOW,
      ).update,
    ).toEqual({ on_auto_pause_start_template_id: null });
    expect(
      resolveAutoPlan(
        request({ onAutoPauseStartTemplateId: 4 }),
        { ...current, chainTemplateId: 4 },
        NOW,
      ).update,
    ).toEqual({});
  });

  it('refuses a rule to start without a pause date', () => {
    expect(() =>
      resolveAutoPlan(request({ onAutoPauseStartTemplateId: 4 }), plan(), NOW),
    ).toThrow(
      new BadRequestException(
        'Choose a pause date before choosing the rule to start after it',
      ),
    );
  });

  it('drops the rule to start when the pause date is cleared', () => {
    const result = resolveAutoPlan(
      request({ autoPauseAt: null }),
      plan({ autoPauseAt: LATER, chainTemplateId: 4 }),
      NOW,
    );
    expect(result.plan).toEqual(plan());
    expect(result.update).toEqual({
      auto_pause_at: null,
      on_auto_pause_start_template_id: null,
    });
  });
});
