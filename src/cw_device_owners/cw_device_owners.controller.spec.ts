import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceOwnersController } from './cw_device_owners.controller';

describe('CwDeviceOwnersController', () => {
  let controller: CwDeviceOwnersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDeviceOwnersController],
    }).compile();

    controller = module.get<CwDeviceOwnersController>(CwDeviceOwnersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
