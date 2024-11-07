import { Test, TestingModule } from '@nestjs/testing';
import { ReportsTemplatesService } from './reports_templates.service';
import { ReportTemplatesRepository } from 'src/repositories/reports_templates.repository';
import { BaseRepository } from 'src/repositories/base.repository';

describe('ReportsTemplatesService', () => {
  let service: ReportsTemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsTemplatesService,
        {
          provide: ReportTemplatesRepository,
          useClass: BaseRepository, // Mock base repository or use a custom mock class
        },
      ],
    }).compile();

    service = module.get<ReportsTemplatesService>(ReportsTemplatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
