import { Test, TestingModule } from '@nestjs/testing';
import { BaseRepository } from './base.repository';
import { SupabaseService } from '../supabase/supabase.service';

describe('BaseRepository', () => {
  let repository: BaseRepository<any>;
  let supabaseService: jest.Mocked<SupabaseService>;

  const mockTableName = 'mock_table';

  beforeEach(async () => {
    // Mock PostgrestFilterBuilder methods
    const mockPostgrestFilterBuilder = {
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
    };

    const mockSupabaseClient = {
      from: jest.fn(() => mockPostgrestFilterBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaseRepository,
        {
          provide: SupabaseService,
          useValue: {
            getSupabaseClient: jest.fn(() => mockSupabaseClient),
          },
        },
      ],
    }).compile();

    supabaseService = module.get<SupabaseService>(SupabaseService) as jest.Mocked<SupabaseService>;
    repository = new BaseRepository<any>(supabaseService, mockTableName);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all items', async () => {
      const mockItems = [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }];

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.select.mockResolvedValueOnce({ data: mockItems, error: null });

      const result = await repository.findAll();
      expect(result).toEqual(mockItems);
      expect(fromMock.select).toHaveBeenCalledWith('*');
    });

    it('should throw an error if fetching items fails', async () => {
      const mockError = new Error('Fetch Failed');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.select.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.findAll()).rejects.toThrow(mockError);
    });
  });

  describe('create', () => {
    it('should insert a new item', async () => {
      const mockItem = { id: 1, name: 'New Item' };

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.insert.mockReturnThis();
      fromMock.select.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: mockItem, error: null });

      const result = await repository.create({ name: 'New Item' });
      expect(result).toEqual(mockItem);
      expect(fromMock.insert).toHaveBeenCalledWith({ name: 'New Item' });
    });

    it('should throw an error if insertion fails', async () => {
      const mockError = new Error('Insert Failed');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.insert.mockReturnThis();
      fromMock.select.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.create({ name: 'New Item' })).rejects.toThrow(mockError);
    });
  });

  describe('partialUpdate', () => {
    it('should update a specific item partially', async () => {
      const mockItem = { id: 1, name: 'Updated Item' };

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.update.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.select.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: mockItem, error: null });

      const result = await repository.partialUpdate(1, { name: 'Updated Item' });
      expect(result).toEqual(mockItem);
      expect(fromMock.update).toHaveBeenCalledWith({ name: 'Updated Item' });
      expect(fromMock.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw an error if partial update fails', async () => {
      const mockError = new Error('Update Failed');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.update.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.select.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.partialUpdate(1, { name: 'Updated Item' })).rejects.toThrow(mockError);
    });
  });

  describe('fullUpdate', () => {
    it('should perform a full update on a specific item', async () => {
      const mockItem = { id: 1, name: 'Fully Updated Item' };

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.update.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.select.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: mockItem, error: null });

      const result = await repository.fullUpdate(1, mockItem);
      expect(result).toEqual(mockItem);
      expect(fromMock.update).toHaveBeenCalledWith(mockItem);
      expect(fromMock.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw an error if full update fails', async () => {
      const mockError = new Error('Full Update Failed');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.update.mockReturnThis();
      fromMock.eq.mockReturnThis();
      fromMock.select.mockReturnThis();
      fromMock.single.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.fullUpdate(1, { name: 'Fully Updated Item' })).rejects.toThrow(mockError);
    });
  });

  describe('delete', () => {
    it('should delete a specific item by id', async () => {
      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.delete.mockReturnThis();
      fromMock.eq.mockResolvedValueOnce({ data: null, error: null });

      await expect(repository.delete(1)).resolves.not.toThrow();
      expect(fromMock.delete).toHaveBeenCalled();
      expect(fromMock.eq).toHaveBeenCalledWith('id', 1);
    });

    it('should throw an error if deletion fails', async () => {
      const mockError = new Error('Delete Failed');

      const fromMock = supabaseService.getSupabaseClient().from(mockTableName) as jest.Mocked<any>;

      fromMock.delete.mockReturnThis();
      fromMock.eq.mockResolvedValueOnce({ data: null, error: mockError });

      await expect(repository.delete(1)).rejects.toThrow(mockError);
    });
  });
});
