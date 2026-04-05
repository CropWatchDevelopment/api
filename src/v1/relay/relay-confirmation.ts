import type {
  RelayConfirmation,
  RelayDataRow,
  RelayNumber,
  RelayTargetState,
} from './relay.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRelayStatus(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  const normalized = readString(value).toUpperCase();
  if (!normalized) {
    return null;
  }

  if (['ON', 'TRUE', 'HIGH', 'H', '1'].includes(normalized)) {
    return true;
  }

  if (['OFF', 'FALSE', 'LOW', 'L', '0'].includes(normalized)) {
    return false;
  }

  return null;
}

function readDecodedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(payload.data) ? payload.data : payload;
  const uplinkMessage = isRecord(data.uplink_message) ? data.uplink_message : null;
  const decodedPayload = uplinkMessage && isRecord(uplinkMessage.decoded_payload)
    ? uplinkMessage.decoded_payload
    : null;

  return decodedPayload ?? {};
}

function readConfirmationTime(payload: Record<string, unknown>): string {
  const data = isRecord(payload.data) ? payload.data : null;
  const uplinkMessage = data && isRecord(data.uplink_message) ? data.uplink_message : null;

  return (
    readString(data?.received_at) ||
    readString(uplinkMessage?.received_at) ||
    readString(payload.time)
  );
}

function readConfirmationDevEui(payload: Record<string, unknown>): string {
  const data = isRecord(payload.data) ? payload.data : null;
  const endDeviceIds = data && isRecord(data.end_device_ids) ? data.end_device_ids : null;
  const identifiers = Array.isArray(payload.identifiers) ? payload.identifiers : [];

  for (const entry of identifiers) {
    if (!isRecord(entry)) {
      continue;
    }

    const deviceIds = isRecord(entry.device_ids) ? entry.device_ids : null;
    const devEui = readString(deviceIds?.dev_eui);
    if (devEui) {
      return devEui.toUpperCase();
    }
  }

  const devEui = readString(endDeviceIds?.dev_eui);
  return devEui ? devEui.toUpperCase() : '';
}

export function parseRelayConfirmation(
  payload: unknown,
): RelayConfirmation | null {
  if (!isRecord(payload)) {
    return null;
  }

  const devEui = readConfirmationDevEui(payload);
  const receivedAt = readConfirmationTime(payload);
  const decodedPayload = readDecodedPayload(payload);

  if (!devEui || !receivedAt) {
    return null;
  }

  const relay1 =
    readRelayStatus(decodedPayload.RO1_status) ??
    readRelayStatus(decodedPayload.DO1_status) ??
    null;
  const relay2 =
    readRelayStatus(decodedPayload.RO2_status) ??
    readRelayStatus(decodedPayload.DO2_status) ??
    null;

  if (relay1 === null && relay2 === null) {
    return null;
  }

  return {
    devEui,
    receivedAt,
    relay1,
    relay2,
  };
}

export function readRelayRowTimestamp(
  row: Pick<RelayDataRow, 'created_at' | 'last_update'> | null | undefined,
): string {
  if (!row) {
    return '';
  }

  return row.created_at || row.last_update || '';
}

export function compareIsoTimestamps(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return leftTime - rightTime;
  }

  return left.localeCompare(right);
}

export function doesRelayRowConfirmTarget(
  row: RelayDataRow,
  relay: RelayNumber,
  targetState: RelayTargetState,
  baselineTime: string,
): boolean {
  const rowTime = readRelayRowTimestamp(row);
  if (!rowTime || compareIsoTimestamps(rowTime, baselineTime) <= 0) {
    return false;
  }

  const relayValue = relay === 1 ? row.relay_1 : row.relay_2;
  if (relayValue === null) {
    return false;
  }

  return targetState === 'on' ? relayValue : !relayValue;
}
