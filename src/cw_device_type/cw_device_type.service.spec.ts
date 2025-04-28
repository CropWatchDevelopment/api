import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceTypeService } from './cw_device_type.service';
import { DeviceTypeRepository } from '../repositories/cw_device_type.repository';

describe('CwDeviceTypeService', () => {
  let service: CwDeviceTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CwDeviceTypeService,
        {
          provide: DeviceTypeRepository,
          useValue: {
            // Mock methods here as needed
            findAll: jest.fn(),
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CwDeviceTypeService>(CwDeviceTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
