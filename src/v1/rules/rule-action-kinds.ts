/**
 * What an action type does, by its name in cw_rule_action_types (matched in
 * lower case, as the alert service and the database tick do).
 */
export type RuleActionKind =
  | 'activate_rule'
  | 'deactivate_rule'
  | 'deactivate_self'
  | 'relay'
  | 'notify';

export function ruleActionKind(
  typeName: string | null | undefined,
): RuleActionKind {
  switch ((typeName ?? '').trim().toLowerCase()) {
    case 'ruleactivate':
      return 'activate_rule';
    case 'ruledeactivate':
      return 'deactivate_rule';
    case 'ruledeactivateself':
      return 'deactivate_self';
    case 'lorawan':
      return 'relay';
    default:
      return 'notify';
  }
}

/** Starts or pauses ANOTHER rule: needs a target. */
export function switchesAnotherRule(kind: RuleActionKind): boolean {
  return kind === 'activate_rule' || kind === 'deactivate_rule';
}

/** A Date/Time rule runs these and nothing else (no e-mail or push yet). */
export function allowedOnDateTimeRule(kind: RuleActionKind): boolean {
  return kind !== 'notify';
}

/** config.targetTemplateId as a positive integer, else null. */
export function readTargetTemplateId(config: unknown): number | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  const raw = (config as Record<string, unknown>).targetTemplateId;
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : null;
}

/**
 * The relay a LoRaWAN action commands: config.recipient is a JSON string
 * {"devEui": "...", "downlink": {...}} (the alert service's format).
 */
export function readRelayDevEui(config: unknown): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  const recipient = (config as Record<string, unknown>).recipient;
  if (typeof recipient !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(recipient);
    const devEui =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).devEui
        : null;
    return typeof devEui === 'string' && devEui.trim() ? devEui.trim() : null;
  } catch {
    return null;
  }
}

/** Dragino "switch for a time, then return to the original state". */
const TIMED_RELAY_OPCODE = 0x05;

/**
 * Whether a relay action's command is a timed pulse. A re-send may repeat only
 * those: repeating a fixed on/off command would re-assert a state somebody may
 * have changed by hand. (The alert service applies the same rule when it
 * sends; this keeps the stored flag truthful.)
 */
export function relayIsTimedPulse(config: unknown): boolean {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const recipient = (config as Record<string, unknown>).recipient;
  if (typeof recipient !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(recipient);
    const downlink =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).downlink
        : null;
    const payload =
      downlink && typeof downlink === 'object'
        ? (downlink as Record<string, unknown>).frm_payload
        : null;
    return (
      typeof payload === 'string' &&
      Buffer.from(payload, 'base64')[0] === TIMED_RELAY_OPCODE
    );
  } catch {
    return false;
  }
}
