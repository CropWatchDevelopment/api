import { Test, TestingModule } from '@nestjs/testing';
import { ReportTemplatesRepository } from './reports_templates.repository';
import { SupabaseService } from '../supabase/supabase.service';
import { ReportsTemplatesRow } from 'src/common/database-types';

describe('ReportTemplatesRepository', () => {
  let repository: ReportTemplatesRepository;
  let supabaseService: jest.Mocked<SupabaseService>;

  beforeEach(async () => {
    const mockPostgrestFilterBuilder = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    const mockSupabaseClient = {
      from: jest.fn(() => mockPostgrestFilterBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportTemplatesRepository,
        {
          provide: SupabaseService,
          useValue: {
            getSupabaseClient: jest.fn(() => mockSupabaseClient),
          },
        },
      ],
    }).compile();

    supabaseService = module.get<SupabaseService>(SupabaseService) as jest.Mocked<SupabaseService>;
    repository = module.get<ReportTemplatesRepository>(ReportTemplatesRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findByDevEui', () => {
    it('should return a report template by dev_eui', async () => {
      const mockData: ReportsTemplatesRow = {
        id: 1,
        dev_eui: 'mock-devEui',
        name: 'mock-template',
        template: { content: 'mock-content' }, // Assuming `template` is JSON
        created_at: new Date().toISOString(),
        owner_id: 'mock-owner',
        recipients: 'mock-recipient@example.com',
      };

      const fromMock = supabaseService.getSupabaseClient().from('reports_templates') as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: mockData, error: null });

      const result = await repository.findByDevEui({ dev_eui: 'mock-devEui' });
      expect(result).toEqual(mockData);
      expect(fromMock.select).toHaveBeenCalledWith('*');
      expect(fromMock.eq).toHaveBeenCalledWith('dev_eui', 'mock-devEui');
      expect(fromMock.single).toHaveBeenCalled();
    });

    it('should throw an error if the device is not found', async () => {
      const mockError = new Error('Device not found');

      const fromMock = supabaseService.getSupabaseClient().from('reports_templates') as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.findByDevEui({ dev_eui: 'mock-devEui' })).rejects.toThrow(
        `Failed to find device with dev_eui mock-devEui: Device not found`
      );
    });

    it('should throw an error if no data is returned', async () => {
      const fromMock = supabaseService.getSupabaseClient().from('reports_templates') as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: null, error: null });

      await expect(repository.findByDevEui({ dev_eui: 'mock-devEui' })).rejects.toThrow(
        `Device with dev_eui mock-devEui not found.`
      );
    });
  });
});
