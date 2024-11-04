// src/cw_devices/cw_devices.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { CwDevicesController } from './cw_devices.controller';
import { CwDevicesService } from './cw_devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

// Define a mock class for CwDevicesService
class MockCwDevicesService {
  create = jest.fn();
  findAll = jest.fn();
  partialUpdate = jest.fn();
  fullUpdate = jest.fn();
  delete = jest.fn();
}

describe('CwDevicesController', () => {
  let controller: CwDevicesController;
  let service: CwDevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDevicesController],
      providers: [
        {
          provide: CwDevicesService,
          useClass: MockCwDevicesService, // Use the mock class here
        },
      ],
    }).compile();

    controller = module.get<CwDevicesController>(CwDevicesController);
    service = module.get<CwDevicesService>(CwDevicesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call CwDevicesService.create with correct data', async () => {
    const dto = new CreateDeviceDto();
    await controller.create(dto);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('should call CwDevicesService.findAll', async () => {
    await controller.findAll();
    expect(service.findAll).toHaveBeenCalled();
  });

  it('should call CwDevicesService.partialUpdate with correct parameters', async () => {
    const dto = new UpdateDeviceDto();
    const id = 1;
    await controller.PartialUpdate(id, dto);
    expect(service.partialUpdate).toHaveBeenCalledWith(id, dto);
  });

  it('should call CwDevicesService.fullUpdate with correct parameters', async () => {
    const dto = new UpdateDeviceDto();
    const id = 1;
    await controller.FullUpdate(id, dto);
    expect(service.fullUpdate).toHaveBeenCalledWith(id, dto);
  });

  // it('should call CwDevicesService.delete with correct id', async () => {
  //   const id = 1;
  //   await controller.Delete(id);
  //   expect(service.delete).toHaveBeenCalledWith(id);
  // });
});
