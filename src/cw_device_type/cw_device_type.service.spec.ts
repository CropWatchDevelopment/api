import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceTypeService } from './cw_device_type.service';

describe('CwDeviceTypeService', () => {
  let service: CwDeviceTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CwDeviceTypeService],
    }).compile();

    service = module.get<CwDeviceTypeService>(CwDeviceTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
