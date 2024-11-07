import { Test, TestingModule } from '@nestjs/testing';
import { DataRepository } from './data.repository';
import { SupabaseService } from '../supabase/supabase.service';

describe('DataRepository', () => {
  let repository: DataRepository;
  let supabaseService: jest.Mocked<SupabaseService>;

  beforeEach(async () => {
    // Mock PostgrestFilterBuilder methods
    const mockPostgrestFilterBuilder = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };

    const mockSupabaseClient = {
      from: jest.fn(() => mockPostgrestFilterBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataRepository,
        {
          provide: SupabaseService,
          useValue: {
            getSupabaseClient: jest.fn(() => mockSupabaseClient),
          },
        },
      ],
    }).compile();

    supabaseService = module.get<SupabaseService>(SupabaseService) as jest.Mocked<SupabaseService>;
    repository = module.get<DataRepository>(DataRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findAllByTable', () => {
    it('should retrieve data from the table with given filters', async () => {
      const mockData = [{ id: 1, dev_eui: 'mockDevEui' }, { id: 2, dev_eui: 'mockDevEui' }];
      const mockTableName = 'mock_table';

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.range.mockReturnThis();
      fromMock.order.mockResolvedValueOnce({ data: mockData, error: null });

      const result = await repository.findAllByTable(mockTableName, 'mockDevEui', 0, 10, true);
      expect(result).toEqual(mockData);
      expect(fromMock.eq).toHaveBeenCalledWith('dev_eui', 'mockDevEui');
      expect(fromMock.range).toHaveBeenCalledWith(0, 9);
      expect(fromMock.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('should throw an error if data retrieval fails', async () => {
      const mockTableName = 'mock_table';
      const mockError = new Error('Query failed');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.range.mockReturnThis();
      fromMock.order.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(
        repository.findAllByTable(mockTableName, 'mockDevEui', 0, 10, true)
      ).rejects.toThrow(`Failed to retrieve data from table ${mockTableName}: Query failed`);
    });
  });

  describe('findByIdInTable', () => {
    it('should return a single record by ID', async () => {
      const mockData = { id: 1, dev_eui: 'mockDevEui' };
      const mockTableName = 'mock_table';

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: mockData, error: null });

      const result = await repository.findByIdInTable(mockTableName, 1);
      expect(result).toEqual(mockData);
      expect(fromMock.eq).toHaveBeenCalledWith('id', 1);
      expect(fromMock.single).toHaveBeenCalled();
    });

    it('should throw an error if record is not found', async () => {
      const mockTableName = 'mock_table';
      const mockError = new Error('Record not found');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.select.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.findByIdInTable(mockTableName, 1)).rejects.toThrow(
        `Failed to find record with id 1 in table ${mockTableName}: Record not found`
      );
    });
  });
});
