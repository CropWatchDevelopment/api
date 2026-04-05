import type { RelayNumber, RelayTargetState } from './relay.types';

export interface TtiApplicationDownlink {
  confirmed: boolean;
  correlation_ids?: string[];
  f_port: number;
  frm_payload: string;
  priority: 'NORMAL';
}

interface TimedRelayDownlinkInput {
  correlationIds?: string[];
  durationMs: number;
  relay1On: boolean;
  relay2On: boolean;
}

const NO_ACTION_BYTE = 0x11;
const RELAY_COMMAND_PREFIX = 0x03;
const TIMED_RELAY_COMMAND_PREFIX = 0x05;
const TIMED_RELAY_REVERT_TO_ORIGINAL_MODE = 0x01;

function buildDownlink(
  bytes: number[],
  correlationIds: string[] = [],
): TtiApplicationDownlink {
  return {
    confirmed: false,
    correlation_ids: correlationIds,
    f_port: 2,
    frm_payload: Buffer.from(bytes).toString('base64'),
    priority: 'NORMAL',
  };
}

function encodeFixedRelayState(targetState: RelayTargetState): number {
  return targetState === 'on' ? 0x01 : 0x00;
}

function encodeTimedRelayState(relayOn: boolean): number {
  return relayOn ? 0x01 : 0x00;
}

function encodeTimedDurationMs(durationMs: number): number[] {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 0xffffffff) {
    throw new RangeError('durationMs must be an integer between 1 and 4294967295');
  }

  if (durationMs <= 0xffff) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(durationMs);
    return [...buffer];
  }

  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(durationMs);
  return [...buffer];
}

export function buildRelayDownlink(
  relay: RelayNumber,
  targetState: RelayTargetState,
  correlationIds: string[] = [],
): TtiApplicationDownlink {
  const relay1Byte =
    relay === 1 ? encodeFixedRelayState(targetState) : NO_ACTION_BYTE;
  const relay2Byte =
    relay === 2 ? encodeFixedRelayState(targetState) : NO_ACTION_BYTE;

  return buildDownlink(
    [RELAY_COMMAND_PREFIX, relay1Byte, relay2Byte],
    correlationIds,
  );
}

export function buildTimedRelayDownlink(
  input: TimedRelayDownlinkInput,
): TtiApplicationDownlink {
  const relayStateByte =
    (encodeTimedRelayState(input.relay1On) << 4) |
    encodeTimedRelayState(input.relay2On);

  return buildDownlink(
    [
      TIMED_RELAY_COMMAND_PREFIX,
      TIMED_RELAY_REVERT_TO_ORIGINAL_MODE,
      relayStateByte,
      ...encodeTimedDurationMs(input.durationMs),
    ],
    input.correlationIds ?? [],
  );
}
