import {
  RULE_STATUS_REASONS,
  type RuleNextStartDto,
  type RuleRefDto,
  type RuleStatusDto,
} from './dto/rule-status.dto';

/** The columns of cw_rule_templates the status is read from. */
export interface RuleStatusRow {
  id: number;
  is_active: boolean | null;
  created_at: string | null;
  auto_start_at: string | null;
  auto_pause_at: string | null;
  on_auto_pause_start_template_id: number | null;
  status_changed_at: string | null;
  status_reason: string | null;
  status_changed_by_user: string | null;
  status_changed_by_template: number | null;
}

/** A rule that starts another rule when it auto-pauses at `at`. */
export interface RuleChainSource {
  id: number;
  at: string;
}

export interface RuleStatusContext {
  /** Names of the people who changed a status, without the ones the caller may not see. */
  userNames: ReadonlyMap<string, string>;
  /** Names of the rules the caller can see. */
  ruleNames: ReadonlyMap<number, string>;
  /** Target rule id -> the rules that start it when they auto-pause. */
  chainSources: ReadonlyMap<number, readonly RuleChainSource[]>;
}

export const EMPTY_RULE_STATUS_CONTEXT: RuleStatusContext = {
  userNames: new Map(),
  ruleNames: new Map(),
  chainSources: new Map(),
};

function ruleRef(
  id: number | null,
  context: RuleStatusContext,
): RuleRefDto | null {
  return typeof id === 'number'
    ? { id, name: context.ruleNames.get(id) ?? null }
    : null;
}

/** The earliest planned start of a paused rule: its own date, or a chain. */
function nextStartOf(
  row: RuleStatusRow,
  context: RuleStatusContext,
): RuleNextStartDto | null {
  const candidates: RuleNextStartDto[] = (
    context.chainSources.get(row.id) ?? []
  ).map((source) => ({
    at: source.at,
    source: 'chain',
    byRule: ruleRef(source.id, context),
  }));
  if (row.auto_start_at) {
    candidates.push({ at: row.auto_start_at, source: 'date', byRule: null });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, candidate) =>
    Date.parse(candidate.at) < Date.parse(earliest.at) ? candidate : earliest,
  );
}

/**
 * What the Status column shows for one rule: running, paused, or scheduled
 * (paused with a start already planned), with who or what caused it.
 */
export function computeRuleStatus(
  row: RuleStatusRow,
  context: RuleStatusContext = EMPTY_RULE_STATUS_CONTEXT,
): RuleStatusDto {
  const isActive = row.is_active ?? true;
  const nextStart = isActive ? null : nextStartOf(row, context);

  return {
    state: isActive ? 'running' : nextStart ? 'scheduled' : 'paused',
    since: row.status_changed_at ?? row.created_at,
    reason:
      RULE_STATUS_REASONS.find((known) => known === row.status_reason) ?? null,
    byUserName:
      typeof row.status_changed_by_user === 'string'
        ? (context.userNames.get(row.status_changed_by_user) ?? null)
        : null,
    byRule: ruleRef(row.status_changed_by_template, context),
    autoPauseAt: isActive ? (row.auto_pause_at ?? null) : null,
    thenStart:
      isActive && row.auto_pause_at
        ? ruleRef(row.on_auto_pause_start_template_id, context)
        : null,
    nextStart,
  };
}
