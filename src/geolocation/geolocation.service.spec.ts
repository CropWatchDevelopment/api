import { Test, TestingModule } from '@nestjs/testing';
import { GeolocationService } from './geolocation.service';

describe('GeolocationService', () => {
  let service: GeolocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeolocationService],
    }).compile();

    service = module.get<GeolocationService>(GeolocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
