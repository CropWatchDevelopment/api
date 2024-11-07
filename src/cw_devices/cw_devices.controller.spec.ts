import { Test, TestingModule } from '@nestjs/testing';
import { CwDevicesController } from './cw_devices.controller';
import { CwDevicesService } from './cw_devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';

describe('CwDevicesController', () => {
  let controller: CwDevicesController;
  let service: CwDevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDevicesController],
      providers: [
        {
          provide: CwDevicesService,
          useValue: {
            findAll: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue({
              id: 1,
              dev_eui: 'test-dev-eui',
              name: 'Test Device',
            }),
            create: jest.fn().mockResolvedValue({
              id: 1,
              dev_eui: 'test-dev-eui',
              name: 'Test Device',
            }),
            partialUpdate: jest.fn().mockResolvedValue({
              id: 1,
              name: 'Updated Device',
            }),
            fullUpdate: jest.fn().mockResolvedValue({
              id: 1,
              dev_eui: 'test-dev-eui',
              name: 'Updated Device',
            }),
            delete: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<CwDevicesController>(CwDevicesController);
    service = module.get<CwDevicesService>(CwDevicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of devices', async () => {
      const result = await controller.findAll();
      expect(result).toEqual([]);
      expect(service.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a new device', async () => {
      const createDto = { dev_eui: 'test-dev-eui', name: 'Test Device' } as CreateDeviceDto;
      const result = await controller.create(createDto);
      expect(result).toEqual({
        id: 1,
        dev_eui: 'test-dev-eui',
        name: 'Test Device',
      });
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('partialUpdate', () => {
    it('should partially update a device', async () => {
      const updateDto = { name: 'Updated Device' };
      const result = await controller.PartialUpdate(1, updateDto);
      expect(result).toEqual({ id: 1, name: 'Updated Device' });
      expect(service.partialUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('fullUpdate', () => {
    it('should fully update a device', async () => {
      const updateDto = { dev_eui: 'test-dev-eui', name: 'Updated Device' };
      const result = await controller.FullUpdate(1, updateDto);
      expect(result).toEqual({
        id: 1,
        dev_eui: 'test-dev-eui',
        name: 'Updated Device',
      });
      expect(service.fullUpdate).toHaveBeenCalledWith(1, updateDto);
    });
  });

  describe('delete', () => {
    it('should delete a device', async () => {
      const result = await controller.Delete(1);
      expect(result).toBeUndefined();
      // expect(result).toBeUndefined();
      // expect(service.delete).toHaveBeenCalledWith(1);
    });
  });
});
