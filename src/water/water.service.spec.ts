import { Test, TestingModule } from '@nestjs/testing';
import { WaterService } from './water.service';

describe('WaterService', () => {
  let service: WaterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WaterService],
    }).compile();

    service = module.get<WaterService>(WaterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
