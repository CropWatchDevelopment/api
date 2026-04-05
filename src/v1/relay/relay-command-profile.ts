import type { RelayNumber, RelayTargetState } from './relay.types';

export interface TtiApplicationDownlink {
  confirmed: boolean;
  correlation_ids?: string[];
  f_port: number;
  frm_payload: string;
  priority: 'NORMAL';
}

const RELAY_COMMAND_BYTES: Record<
  `${RelayNumber}:${RelayTargetState}`,
  [number, number, number]
> = {
  '1:off': [0x03, 0x01, 0x00],
  '1:on': [0x03, 0x01, 0x01],
  '2:off': [0x03, 0x02, 0x00],
  '2:on': [0x03, 0x02, 0x01],
};

export function buildRelayDownlink(
  relay: RelayNumber,
  targetState: RelayTargetState,
  correlationIds: string[] = [],
): TtiApplicationDownlink {
  const bytes = RELAY_COMMAND_BYTES[`${relay}:${targetState}`];

  return {
    confirmed: false,
    correlation_ids: correlationIds,
    f_port: 2,
    frm_payload: Buffer.from(bytes).toString('base64'),
    priority: 'NORMAL',
  };
}
