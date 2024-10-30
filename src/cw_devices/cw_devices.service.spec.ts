import { Test, TestingModule } from '@nestjs/testing';
<<<<<<<< HEAD:src/cw_devices/cw_devices.service.spec.ts
import { CwDevicesService } from './cw_devices.service';
========
import { DeviceService } from './device.service';
import { DeviceRepository } from '../repositories/device.repository';
>>>>>>>> 7ff24679718c627ba6e18a536995a2e3a2df0597:src/device/device.service.spec.ts

describe('CwDevicesService', () => {
  let service: CwDevicesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
<<<<<<<< HEAD:src/cw_devices/cw_devices.service.spec.ts
      providers: [CwDevicesService],
========
      providers: [
        DeviceService,
        {
          provide: DeviceRepository,
          useValue: { /* mock repository methods */ },
        },
      ],
>>>>>>>> 7ff24679718c627ba6e18a536995a2e3a2df0597:src/device/device.service.spec.ts
    }).compile();

    service = module.get<CwDevicesService>(CwDevicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
