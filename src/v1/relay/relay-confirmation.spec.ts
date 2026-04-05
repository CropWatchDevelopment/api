import {
  doesRelayRowConfirmTarget,
  parseRelayConfirmation,
} from './relay-confirmation';

describe('parseRelayConfirmation', () => {
  it('extracts relay states and confirmation metadata from a TTI uplink', () => {
    const confirmation = parseRelayConfirmation({
      name: 'as.up.data.forward',
      time: '2026-04-05T02:35:00.837493998Z',
      identifiers: [
        {
          device_ids: {
            application_ids: {
              application_id: 'dragino-ja-lt-22222',
            },
            dev_eui: 'A8404194635A05FB',
            device_id: 'eui-a8404194635a05fb',
          },
        },
      ],
      data: {
        received_at: '2026-04-05T02:35:00.834081749Z',
        uplink_message: {
          decoded_payload: {
            DO1_status: 'H',
            DO2_status: 'H',
            RO1_status: 'ON',
            RO2_status: 'OFF',
          },
        },
      },
    });

    expect(confirmation).toEqual({
      devEui: 'A8404194635A05FB',
      receivedAt: '2026-04-05T02:35:00.834081749Z',
      relay1: true,
      relay2: false,
    });
  });

  it('ignores payloads that do not contain relay status fields', () => {
    expect(
      parseRelayConfirmation({
        data: {
          received_at: '2026-04-05T02:35:00.834081749Z',
          uplink_message: {
            decoded_payload: {
              temperature: 20.1,
            },
          },
        },
      }),
    ).toBeNull();
  });
});

describe('doesRelayRowConfirmTarget', () => {
  it('matches newer relay rows that confirm the requested state', () => {
    expect(
      doesRelayRowConfirmTarget(
        {
          created_at: '2026-04-05T02:35:00.834081749Z',
          dev_eui: 'A8404194635A05FB',
          id: 42,
          last_update: '2026-04-05T02:35:00.834081749Z',
          relay_1: true,
          relay_2: false,
        },
        1,
        'on',
        '2026-04-05T02:34:58.000000000Z',
      ),
    ).toBe(true);
  });

  it('rejects rows that are not newer than the command request', () => {
    expect(
      doesRelayRowConfirmTarget(
        {
          created_at: '2026-04-05T02:34:58.000000000Z',
          dev_eui: 'A8404194635A05FB',
          id: 42,
          last_update: '2026-04-05T02:34:58.000000000Z',
          relay_1: true,
          relay_2: false,
        },
        1,
        'on',
        '2026-04-05T02:34:58.000000000Z',
      ),
    ).toBe(false);
  });
});
