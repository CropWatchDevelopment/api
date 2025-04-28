import { Test, TestingModule } from '@nestjs/testing';
import { LocationService } from './location.service';
import { BaseRepository } from '../repositories/base.repository';
import { LocationRow } from '../common/database-types';
import { CreateLocationDto } from './dto/create-location.dto';

describe('LocationService', () => {
  let service: LocationService;
  let repository: BaseRepository<LocationRow>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        {
          provide: BaseRepository,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue({
              id: 1,
              name: 'Test Location',
              lat: 35.6895,
              long: 139.6917,
            }),
            create: jest.fn().mockResolvedValue({
              id: 1,
              name: 'Test Location',
              lat: 35.6895,
              long: 139.6917,
            }),
            partialUpdate: jest.fn().mockResolvedValue({
              id: 1,
              name: 'Updated Location',
            }),
            fullUpdate: jest.fn().mockResolvedValue({
              id: 1,
              name: 'Updated Location',
              lat: 35.6895,
              long: 139.6917,
            }),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
    repository = module.get<BaseRepository<LocationRow>>(BaseRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of locations', async () => {
      const result = await service.findAll();
      expect(result).toEqual([]);
      expect(repository.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a new location', async () => {
      const createDto = {
        name: 'Test Location',
        lat: 35.6895,
        long: 139.6917,
        // created_at: new Date(),
        description: "Mock Description",
        location_id: 1,
        map_zoom: 5,
        owner_id: 'test-owner',

      } as CreateLocationDto;
      const result = await service.create(createDto);
      expect(result).toEqual({
        id: 1,
        name: 'Test Location',
        lat: 35.6895,
        long: 139.6917,
      });
      expect(repository.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('partialUpdate', () => {
    it('should partially update a location', async () => {
      const updateDto = { name: 'Updated Location' } as Partial<LocationRow>;
      const result = await service.partialUpdate(1, updateDto);
      expect(result).toEqual({ id: 1, name: 'Updated Location' });
      expect(repository.partialUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('fullUpdate', () => {
    it('should fully update a location', async () => {
      const updateDto = {
        name: 'Updated Location',
        lat: 35.6895,
        long: 139.6917,
      } as LocationRow;
      const result = await service.fullUpdate(1, updateDto);
      expect(result).toEqual({
        id: 1,
        name: 'Updated Location',
        lat: 35.6895,
        long: 139.6917,
      });
      expect(repository.fullUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('delete', () => {
    it('should delete a location', async () => {
      const result = await service.delete(1);
      expect(result).toBeUndefined();
      expect(repository.delete).toHaveBeenCalledWith(1);
    });
  });
});
