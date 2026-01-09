import { Test, TestingModule } from '@nestjs/testing';
import { SoilService } from './soil.service';

describe('SoilService', () => {
  let service: SoilService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SoilService],
    }).compile();

    service = module.get<SoilService>(SoilService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
