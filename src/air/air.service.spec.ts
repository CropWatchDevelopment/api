import { Test, TestingModule } from '@nestjs/testing';
import { AirService } from './air.service';

describe('AirService', () => {
  let service: AirService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AirService],
    }).compile();

    service = module.get<AirService>(AirService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
