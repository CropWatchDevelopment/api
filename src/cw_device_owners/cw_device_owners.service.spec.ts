import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceOwnersService } from './cw_device_owners.service';
import { SupabaseService } from '../supabase/supabase.service';
import { DevicesOwnersRow } from '../common/database-types';
import { DeviceOwnerRepository } from '../repositories/cw_device_owners.repository';
import { createMockSupabaseClient } from '../__mocks__/supabase';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';

describe('CwDeviceOwnersService', () => {
  let service: CwDeviceOwnersService;
  let repository: DeviceOwnerRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CwDeviceOwnersService,
        {
          provide: DeviceOwnerRepository,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue({
              id: 1,
              owner_id: 'test-owner',
              dev_eui: 'test-dev-eui',
            }),
            create: jest.fn().mockResolvedValue({
              id: 1,
              owner_id: 'test-owner',
              dev_eui: 'test-dev-eui',
            }),
            partialUpdate: jest.fn().mockResolvedValue({
              id: 1,
              owner_id: 'updated-owner',
            }),
            fullUpdate: jest.fn().mockResolvedValue({
              id: 1,
              owner_id: 'updated-owner',
              dev_eui: 'test-dev-eui',
            }),
            delete: jest.fn().mockResolvedValue(undefined),
            findByDevEuiAndUID: jest.fn().mockResolvedValue({
              id: 1,
              dev_eui: 'test-dev-eui',
              user_id: 'test-user',
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: {
            getSupabaseClient: createMockSupabaseClient,
          },
        },
      ],
    }).compile();

    service = module.get<CwDeviceOwnersService>(CwDeviceOwnersService);
    repository = module.get<DeviceOwnerRepository>(DeviceOwnerRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of device owners', async () => {
      const result = await service.findAll();
      expect(result).toEqual([]);
      expect(repository.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a new device owner', async () => {
      const createDto = { owner_id: 1, user_id: 'user_name', permission_level: 1, dev_eui: 'test-dev-eui' } as Partial<DevicesOwnersRow>;
      const result = await service.create(createDto as CreateDeviceOwnerDto);
      expect(result).toEqual({ id: 1, owner_id: 'test-owner', dev_eui: 'test-dev-eui' });
      expect(repository.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('partialUpdate', () => {
    it('should partially update a device owner', async () => {
      const updateDto = { owner_id: 1 } as UpdateDeviceOwnerDto;
      const result = await service.partialUpdate(1, updateDto);
      expect(result).toEqual({ id: 1, owner_id: 'updated-owner' });
      expect(repository.partialUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('fullUpdate', () => {
    it('should fully update a device owner', async () => {
      const updateDto = { owner_id: 1, dev_eui: 'test-dev-eui', user_id: 'user_name', permission_level: 1 } as UpdateDeviceOwnerDto;
      const result = await service.fullUpdate(1, updateDto);
      expect(result).toEqual({
        id: 1,
        owner_id: 'updated-owner',
        dev_eui: 'test-dev-eui',
      });
      expect(repository.fullUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('delete', () => {
    it('should delete a device owner', async () => {
      const result = await service.delete(1);
      expect(result).toBeUndefined();
      expect(repository.delete).toHaveBeenCalledWith(1);
    });
  });

  describe('findByDevEuiAndUID', () => {
    it('should return a device owner by dev_eui and user_id', async () => {
      const result = await service.getDeviceOwnerByDevEuiAndUID('test-dev-eui', 'test-user');
      expect(result).toEqual({ id: 1, dev_eui: 'test-dev-eui', user_id: 'test-user' });
      expect(repository.findByDevEuiAndUID).toHaveBeenCalledWith(
        'test-dev-eui',
        'test-user',
      );
    });
  });
});
