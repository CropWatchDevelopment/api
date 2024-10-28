import { Test, TestingModule } from '@nestjs/testing';
import { CwDevicesService } from './cw_devices.service';

describe('CwDevicesService', () => {
  let service: CwDevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CwDevicesService],
    }).compile();

    service = module.get<CwDevicesService>(CwDevicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
