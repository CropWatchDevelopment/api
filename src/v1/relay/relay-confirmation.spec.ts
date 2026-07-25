import { parseRelayConfirmation } from './relay-confirmation';

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

  it('extracts relay states from the unwrapped ApplicationUp webhook body', () => {
    const confirmation = parseRelayConfirmation({
      correlation_ids: ['gs:uplink:01KNDW036XV11HRWNEG0S5HDY6'],
      end_device_ids: {
        application_ids: {
          application_id: 'dragino-ja-lt-22222',
        },
        dev_addr: '260F800C',
        dev_eui: 'A8404194635A05FB',
        device_id: 'eui-a8404194635a05fb',
      },
      received_at: '2026-04-05T03:46:46.331128009Z',
      uplink_message: {
        decoded_payload: {
          DO1_status: 'H',
          DO2_status: 'H',
          RO1_status: 'ON',
          RO2_status: 'ON',
        },
      },
    });

    expect(confirmation).toEqual({
      devEui: 'A8404194635A05FB',
      receivedAt: '2026-04-05T03:46:46.331128009Z',
      relay1: true,
      relay2: true,
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
