import {
  computeRuleStatus,
  type RuleStatusContext,
  type RuleStatusRow,
} from './rule-status';

const row = (overrides: Partial<RuleStatusRow> = {}): RuleStatusRow => ({
  id: 1,
  is_active: true,
  created_at: '2026-11-01T00:00:00+00:00',
  auto_start_at: null,
  auto_pause_at: null,
  on_auto_pause_start_template_id: null,
  status_changed_at: null,
  status_reason: null,
  status_changed_by_user: null,
  status_changed_by_template: null,
  ...overrides,
});

const context = (
  overrides: Partial<RuleStatusContext> = {},
): RuleStatusContext => ({
  userNames: new Map(),
  ruleNames: new Map(),
  chainSources: new Map(),
  ...overrides,
});

describe('computeRuleStatus', () => {
  it('a rule that never changed is running since it was created', () => {
    expect(computeRuleStatus(row())).toEqual({
      state: 'running',
      since: '2026-11-01T00:00:00+00:00',
      reason: null,
      byUserName: null,
      byRule: null,
      autoPauseAt: null,
      thenStart: null,
      nextStart: null,
    });
  });

  it('treats a missing is_active as running, like the alert service', () => {
    expect(computeRuleStatus(row({ is_active: null })).state).toBe('running');
  });

  it('names the person who paused it', () => {
    const status = computeRuleStatus(
      row({
        is_active: false,
        status_changed_at: '2026-11-20T09:00:00+00:00',
        status_reason: 'manual',
        status_changed_by_user: 'user-1',
      }),
      context({ userNames: new Map([['user-1', 'Aki']]) }),
    );

    expect(status).toMatchObject({
      state: 'paused',
      since: '2026-11-20T09:00:00+00:00',
      reason: 'manual',
      byUserName: 'Aki',
      nextStart: null,
    });
  });

  it('leaves out a person the caller may not see', () => {
    const status = computeRuleStatus(
      row({ is_active: false, status_changed_by_user: 'staff-1' }),
    );
    expect(status.byUserName).toBeNull();
  });

  it('names the rule that started it, or only its id when it is hidden', () => {
    const started = row({
      status_reason: 'chain',
      status_changed_by_template: 7,
    });

    expect(
      computeRuleStatus(started, context({ ruleNames: new Map([[7, 'Day']]) }))
        .byRule,
    ).toEqual({ id: 7, name: 'Day' });
    expect(computeRuleStatus(started).byRule).toEqual({ id: 7, name: null });
  });

  it('ignores a reason it does not know', () => {
    expect(
      computeRuleStatus(row({ status_reason: 'magic' })).reason,
    ).toBeNull();
  });

  it('a running rule shows its pause date and the rule that takes over', () => {
    const status = computeRuleStatus(
      row({
        auto_pause_at: '2026-12-01T00:00:00+00:00',
        on_auto_pause_start_template_id: 2,
      }),
      context({ ruleNames: new Map([[2, 'Winter']]) }),
    );

    expect(status.autoPauseAt).toBe('2026-12-01T00:00:00+00:00');
    expect(status.thenStart).toEqual({ id: 2, name: 'Winter' });
  });

  it('a running rule without a pause date has nothing taking over', () => {
    const status = computeRuleStatus(
      row({ on_auto_pause_start_template_id: 2 }),
    );
    expect(status.autoPauseAt).toBeNull();
    expect(status.thenStart).toBeNull();
  });

  it('a running rule is never "scheduled", whatever start date it carries', () => {
    const status = computeRuleStatus(
      row({ auto_start_at: '2026-12-01T00:00:00+00:00' }),
      context({
        chainSources: new Map([[1, [{ id: 5, at: '2026-12-02T00:00:00Z' }]]]),
      }),
    );
    expect(status.state).toBe('running');
    expect(status.nextStart).toBeNull();
  });

  it('a paused rule with a start date is scheduled', () => {
    const status = computeRuleStatus(
      row({
        is_active: false,
        auto_start_at: '2026-12-01T00:00:00+00:00',
        auto_pause_at: '2026-12-24T00:00:00+00:00',
        on_auto_pause_start_template_id: 2,
      }),
    );

    expect(status.state).toBe('scheduled');
    expect(status.nextStart).toEqual({
      at: '2026-12-01T00:00:00+00:00',
      source: 'date',
      byRule: null,
    });
    // The pause date only matters once it runs.
    expect(status.autoPauseAt).toBeNull();
    expect(status.thenStart).toBeNull();
  });

  it('a paused rule that another rule will start is scheduled by that rule', () => {
    const status = computeRuleStatus(
      row({ is_active: false }),
      context({
        ruleNames: new Map([[5, 'Summer']]),
        chainSources: new Map([[1, [{ id: 5, at: '2026-12-02T00:00:00Z' }]]]),
      }),
    );

    expect(status.state).toBe('scheduled');
    expect(status.nextStart).toEqual({
      at: '2026-12-02T00:00:00Z',
      source: 'chain',
      byRule: { id: 5, name: 'Summer' },
    });
  });

  it('shows the earliest of several planned starts', () => {
    const sources = new Map([
      [
        1,
        [
          { id: 5, at: '2026-12-05T00:00:00Z' },
          { id: 6, at: '2026-12-03T00:00:00+09:00' },
        ],
      ],
    ]);

    expect(
      computeRuleStatus(
        row({ is_active: false, auto_start_at: '2026-12-04T00:00:00Z' }),
        context({ chainSources: sources }),
      ).nextStart,
    ).toMatchObject({ source: 'chain', byRule: { id: 6, name: null } });
    expect(
      computeRuleStatus(
        row({ is_active: false, auto_start_at: '2026-12-01T00:00:00Z' }),
        context({ chainSources: sources }),
      ).nextStart,
    ).toMatchObject({ source: 'date', at: '2026-12-01T00:00:00Z' });
  });
});
