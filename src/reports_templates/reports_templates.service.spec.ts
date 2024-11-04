import { Test, TestingModule } from '@nestjs/testing';
import { ReportsTemplatesService } from './reports_templates.service';

describe('ReportsTemplatesService', () => {
  let service: ReportsTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsTemplatesService],
    }).compile();

    service = module.get<ReportsTemplatesService>(ReportsTemplatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
