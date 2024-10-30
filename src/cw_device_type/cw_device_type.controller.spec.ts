import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceTypeController } from './cw_device_type.controller';

describe('CwDeviceTypeController', () => {
  let controller: CwDeviceTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDeviceTypeController],
    }).compile();

    controller = module.get<CwDeviceTypeController>(CwDeviceTypeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
