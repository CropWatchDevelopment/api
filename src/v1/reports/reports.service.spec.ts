import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { SupabaseService } from '../../supabase/supabase.service';

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => null,
            getAdminClient: () => null,
          },
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findOne should allow cropwatch staff to bypass report ownership filters', async () => {
    const reportBuilder = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { report_id: 'rpt-1', name: 'Global report' },
        error: null,
      }),
    };

    const serviceWithClient = new ReportsService({
      getClient: jest.fn(() => ({
        from: jest.fn(() => reportBuilder),
      })),
      getAdminClient: jest.fn(),
    } as unknown as SupabaseService);

    await expect(
      serviceWithClient.findOne(
        'rpt-1',
        { sub: 'staff-1', email: 'staff@cropwatch.io' },
        'Bearer token-1',
      ),
    ).resolves.toEqual({ report_id: 'rpt-1', name: 'Global report' });

    expect(reportBuilder.eq).toHaveBeenCalledWith('report_id', 'rpt-1');
    expect(reportBuilder.eq).not.toHaveBeenCalledWith('user_id', 'staff-1');
  });
});
