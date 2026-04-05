import {
  buildRelayDownlink,
  buildTimedRelayDownlink,
} from './relay-command-profile';

describe('buildRelayDownlink', () => {
  it('maps each relay command to the expected Dragino payload bytes', () => {
    expect(buildRelayDownlink(1, 'off').frm_payload).toBe('AwAR');
    expect(buildRelayDownlink(1, 'on').frm_payload).toBe('AwER');
    expect(buildRelayDownlink(2, 'off').frm_payload).toBe('AxEA');
    expect(buildRelayDownlink(2, 'on').frm_payload).toBe('AxEB');
  });

  it('uses the fixed TTI downlink settings for relay control', () => {
    expect(buildRelayDownlink(1, 'on', ['cropwatch:request:test'])).toEqual({
      confirmed: false,
      correlation_ids: ['cropwatch:request:test'],
      f_port: 2,
      frm_payload: 'AwER',
      priority: 'NORMAL',
    });
  });
});

describe('buildTimedRelayDownlink', () => {
  it('uses a 2-byte big-endian duration for shorter pulses', () => {
    expect(
      buildTimedRelayDownlink({
        durationMs: 1000,
        relay1On: true,
        relay2On: false,
      }).frm_payload,
    ).toBe('BQEQA+g=');
  });

  it('uses a 4-byte big-endian duration for longer pulses', () => {
    expect(
      buildTimedRelayDownlink({
        durationMs: 3_600_000,
        relay1On: true,
        relay2On: false,
      }).frm_payload,
    ).toBe('BQEQADbugA==');
  });
});
