import { Test, TestingModule } from '@nestjs/testing';
import { DeviceService } from './device.service';
import { DeviceRepository } from '../repositories/device.repository';

describe('DeviceService', () => {
  let service: DeviceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceService,
        {
          provide: DeviceRepository,
          useValue: { /* mock repository methods */ },
        },
      ],
    }).compile();

    service = module.get<DeviceService>(DeviceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
