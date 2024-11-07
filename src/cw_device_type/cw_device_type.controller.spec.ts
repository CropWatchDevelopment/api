import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceTypeController } from './cw_device_type.controller';
import { CwDeviceTypeService } from './cw_device_type.service';

describe('CwDeviceTypeController', () => {
  let controller: CwDeviceTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CwDeviceTypeController],
      providers: [
        {
          provide: CwDeviceTypeService,
          useValue: {
            // Mock methods here as needed
            findAll: jest.fn(),
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CwDeviceTypeController>(CwDeviceTypeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
