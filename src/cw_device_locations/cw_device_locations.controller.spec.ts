import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceLocationsController } from './cw_device_locations.controller';

describe('CwDeviceLocationsController', () => {
  let controller: CwDeviceLocationsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDeviceLocationsController],
    }).compile();

    controller = module.get<CwDeviceLocationsController>(CwDeviceLocationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
