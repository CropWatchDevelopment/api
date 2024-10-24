import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceLocationsService } from './cw_device_locations.service';

describe('CwDeviceLocationsService', () => {
  let service: CwDeviceLocationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CwDeviceLocationsService],
    }).compile();

    service = module.get<CwDeviceLocationsService>(CwDeviceLocationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
