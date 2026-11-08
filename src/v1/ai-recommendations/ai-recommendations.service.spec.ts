import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService, Action } from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { AiRecommendationsService } from './ai-recommendations.service';

const USER = { id: 'user-1', isStaff: false } as unknown as AuthenticatedUser;

const report = {
  id: 3,
  dev_eui: '343634316633780C',
  report_type: 'daily',
  period_start: '2026-11-08',
  period_end: '2026-11-08',
  timezone: 'Asia/Tokyo',
  status: 'action',
  max_severity: 3,
  headline_en: 'Some readings need attention',
  body_en: 'Night-time air temperature was below target: 6 °C at the low end.',
  headline_ja: '対応が必要な項目があります',
  body_ja: '夜間の気温は低い時間帯で6°Cでした。',
  findings: [],
  details: [],
  text_source: 'llm',
  created_at: '2026-11-08T16:32:49.779Z',
  updated_at: '2026-11-08T16:32:49.779Z',
};

function createService(
  result: { data: unknown; error: unknown },
  assertDeviceAccess: jest.Mock = jest.fn().mockResolvedValue({}),
) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(result),
  };
  const from = jest.fn(() => builder);
  const supabaseService = { getClient: jest.fn(() => ({ from })) };
  const accessService = { assertDeviceAccess };
  return {
    service: new AiRecommendationsService(
      supabaseService as unknown as SupabaseService,
      accessService as unknown as AccessService,
    ),
    builder,
    from,
  };
}

describe('AiRecommendationsService', () => {
  it("returns the device's newest reports of the type", async () => {
    const access = jest.fn().mockResolvedValue({});
    const { service, builder, from } = createService(
      { data: [report], error: null },
      access,
    );

    await expect(
      service.findForDevice(USER, '343634316633780C', 'daily', 1),
    ).resolves.toEqual([report]);

    expect(access).toHaveBeenCalledWith(
      USER,
      '343634316633780C',
      Action.DataRead,
    );
    expect(from).toHaveBeenCalledWith('cw_ai_recommendations');
    expect(builder.eq).toHaveBeenCalledWith('dev_eui', '343634316633780C');
    expect(builder.eq).toHaveBeenCalledWith('report_type', 'daily');
    expect(builder.order).toHaveBeenCalledWith('period_start', {
      ascending: false,
    });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it('does not select the per-metric stats or the model provenance', async () => {
    const { service, builder } = createService({ data: [], error: null });
    await service.findForDevice(USER, 'DEV-001', 'weekly', 4);
    const [columns] = builder.select.mock.calls[0] as [string];
    expect(columns).not.toMatch(/\bmetrics\b|\bmodel\b|prompt_version/);
  });

  it('returns an empty list when no report exists yet', async () => {
    const { service } = createService({ data: null, error: null });
    await expect(
      service.findForDevice(USER, 'DEV-001', 'daily', 1),
    ).resolves.toEqual([]);
  });

  it('never queries reports for a device the caller cannot see', async () => {
    const denied = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Device not found'));
    const { service, from } = createService({ data: [], error: null }, denied);

    await expect(
      service.findForDevice(USER, 'DEV-001', 'daily', 1),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(from).not.toHaveBeenCalled();
  });

  it('turns a database error into a 500', async () => {
    const { service } = createService({
      data: null,
      error: { message: 'boom' },
    });
    await expect(
      service.findForDevice(USER, 'DEV-001', 'daily', 1),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
