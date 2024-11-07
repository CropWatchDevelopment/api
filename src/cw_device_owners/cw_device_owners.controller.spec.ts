import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceOwnersController } from './cw_device_owners.controller';
import { CwDeviceOwnersService } from './cw_device_owners.service';
import { DevicesOwnersRow } from 'src/common/database-types';
import { CreateDeviceOwnerDto } from './dto/create-device-owner.dto';
import { UpdateDeviceOwnerDto } from './dto/update-device-owner.dto';

describe('CwDeviceOwnersController', () => {
  let controller: CwDeviceOwnersController;
  let service: CwDeviceOwnersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDeviceOwnersController],
      providers: [
        {
          provide: CwDeviceOwnersService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            create: jest.fn().mockResolvedValue({ id: 1, owner_id: 'test-owner' }),
            fullUpdate: jest.fn().mockResolvedValue({ id: 1, owner_id: 'updated-owner' }),
            partialUpdate: jest.fn().mockResolvedValue({ id: 1, owner_id: 'partially-updated-owner' }),
          },
        },
      ],
    }).compile();

    controller = module.get<CwDeviceOwnersController>(CwDeviceOwnersController);
    service = module.get<CwDeviceOwnersService>(CwDeviceOwnersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of device owners', async () => {
      const result = await controller.findAll();
      expect(result).toEqual([]);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a new device owner', async () => {
      const createDto: CreateDeviceOwnerDto = { owner_id: 1, user_id: 'test-owner', permission_level: 1, dev_eui: 'test-device-eui' };
      const result = await controller.create(createDto);
      expect(result).toEqual({ id: 1, owner_id: 'test-owner' });
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('FullUpdate', () => {
    it('should fully update a device owner', async () => {
      const updateDto: UpdateDeviceOwnerDto = { owner_id: 1, user_id: 'test-owner', permission_level: 1, dev_eui: 'test-device-eui' };
      const result = await controller.FullUpdate(1, updateDto);
      expect(result).toEqual({ id: 1, owner_id: 'updated-owner' });
      expect(service.fullUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('PartialUpdate', () => {
    it('should partially update a device owner', async () => {
      const updateDto: UpdateDeviceOwnerDto = { owner_id: 1, user_id: 'test-owner', permission_level: 1, dev_eui: 'test-device-eui' };
      const result = await controller.PartialUpdate(1, updateDto);
      expect(result).toEqual({ id: 1, owner_id: 'partially-updated-owner' });
      expect(service.partialUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });
});
