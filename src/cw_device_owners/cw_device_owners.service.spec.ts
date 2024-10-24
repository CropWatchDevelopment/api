import { Test, TestingModule } from '@nestjs/testing';
import { CwDeviceOwnersService } from './cw_device_owners.service';

describe('CwDeviceOwnersService', () => {
  let service: CwDeviceOwnersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CwDeviceOwnersService],
    }).compile();

    service = module.get<CwDeviceOwnersService>(CwDeviceOwnersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
