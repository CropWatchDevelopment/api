import { Test, TestingModule } from '@nestjs/testing';
import { CwDevicesController } from './cw_devices.controller';

describe('CwDevicesController', () => {
  let controller: CwDevicesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDevicesController],
    }).compile();

    controller = module.get<CwDevicesController>(CwDevicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
