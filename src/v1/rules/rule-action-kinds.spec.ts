import {
  allowedOnDateTimeRule,
  readRelayDevEui,
  relayIsTimedPulse,
  readTargetTemplateId,
  ruleActionKind,
  switchesAnotherRule,
} from './rule-action-kinds';

describe('ruleActionKind', () => {
  it.each([
    ['RuleActivate', 'activate_rule'],
    [' ruledeactivate ', 'deactivate_rule'],
    ['RULEDEACTIVATESELF', 'deactivate_self'],
    ['LoRaWAN', 'relay'],
    ['EMail', 'notify'],
    ['Push', 'notify'],
    ['LINE', 'notify'],
    ['', 'notify'],
    [null, 'notify'],
    [undefined, 'notify'],
  ])('%p is %s', (name, kind) => {
    expect(ruleActionKind(name)).toBe(kind);
  });

  it('knows which kinds need a target and which a Date/Time rule may run', () => {
    expect(switchesAnotherRule('activate_rule')).toBe(true);
    expect(switchesAnotherRule('deactivate_rule')).toBe(true);
    expect(switchesAnotherRule('deactivate_self')).toBe(false);
    expect(switchesAnotherRule('relay')).toBe(false);
    expect(allowedOnDateTimeRule('relay')).toBe(true);
    expect(allowedOnDateTimeRule('deactivate_self')).toBe(true);
    expect(allowedOnDateTimeRule('activate_rule')).toBe(true);
    expect(allowedOnDateTimeRule('notify')).toBe(false);
  });
});

describe('readTargetTemplateId', () => {
  it('reads a positive integer only', () => {
    expect(readTargetTemplateId({ targetTemplateId: 12 })).toBe(12);
    for (const config of [
      { targetTemplateId: '12' },
      { targetTemplateId: 0 },
      { targetTemplateId: -1 },
      { targetTemplateId: 1.5 },
      { targetTemplateId: Number.MAX_SAFE_INTEGER + 2 },
      { recipient: '12' },
      [12],
      null,
      '12',
    ]) {
      expect(readTargetTemplateId(config)).toBeNull();
    }
  });
});

describe('readRelayDevEui', () => {
  const recipient = (value: unknown) => ({ recipient: JSON.stringify(value) });

  it('reads the relay from the recipient JSON', () => {
    expect(
      readRelayDevEui(recipient({ devEui: ' A84041 ', downlink: {} })),
    ).toBe('A84041');
  });

  it('is null for anything else', () => {
    for (const config of [
      recipient({ downlink: {} }),
      recipient({ devEui: '  ' }),
      recipient({ devEui: 7 }),
      recipient('A84041'),
      recipient(null),
      { recipient: 'not json' },
      { recipient: 7 },
      {},
      [],
      null,
      'x',
    ]) {
      expect(readRelayDevEui(config)).toBeNull();
    }
  });
});

describe('relayIsTimedPulse', () => {
  const relay = (frmPayload: unknown) => ({
    recipient: JSON.stringify({
      devEui: 'RELAY',
      downlink: { f_port: 2, frm_payload: frmPayload },
    }),
  });

  it('is true for a timed command (opcode 0x05) only', () => {
    // 05 01 00 3a 98: relay 2 on for 15 s, then back.
    expect(relayIsTimedPulse(relay('BQEAOpg='))).toBe(true);
    // 03 01 11: relay 1 on, and it stays on.
    expect(relayIsTimedPulse(relay('AwER'))).toBe(false);
    // 08 ff: a status request.
    expect(relayIsTimedPulse(relay('CP8='))).toBe(false);
  });

  it('is false for anything that is not a relay command', () => {
    expect(relayIsTimedPulse(relay(''))).toBe(false);
    expect(relayIsTimedPulse(relay(5))).toBe(false);
    expect(relayIsTimedPulse(relay(undefined))).toBe(false);
    expect(relayIsTimedPulse({ recipient: '{"devEui":"RELAY"}' })).toBe(false);
    expect(relayIsTimedPulse({ recipient: '{"downlink":"BQEAOpg="}' })).toBe(
      false,
    );
    expect(relayIsTimedPulse({ recipient: 'null' })).toBe(false);
    expect(relayIsTimedPulse({ recipient: 'not json' })).toBe(false);
    expect(relayIsTimedPulse({ recipient: 7 })).toBe(false);
    expect(relayIsTimedPulse({})).toBe(false);
    expect(relayIsTimedPulse(null)).toBe(false);
    expect(relayIsTimedPulse('BQEAOpg=')).toBe(false);
    expect(relayIsTimedPulse([relay('BQEAOpg=')])).toBe(false);
  });
});
