import { buildRelayDownlink } from './relay-command-profile';

describe('buildRelayDownlink', () => {
  it('maps each relay command to the expected Dragino payload bytes', () => {
    expect(buildRelayDownlink(1, 'off').frm_payload).toBe('AwEA');
    expect(buildRelayDownlink(1, 'on').frm_payload).toBe('AwEB');
    expect(buildRelayDownlink(2, 'off').frm_payload).toBe('AwIA');
    expect(buildRelayDownlink(2, 'on').frm_payload).toBe('AwIB');
  });

  it('uses the fixed TTI downlink settings for relay control', () => {
    expect(buildRelayDownlink(1, 'on', ['cropwatch:request:test'])).toEqual({
      confirmed: false,
      correlation_ids: ['cropwatch:request:test'],
      f_port: 2,
      frm_payload: 'AwEB',
      priority: 'NORMAL',
    });
  });
});
