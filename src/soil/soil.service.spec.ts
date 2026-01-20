import { Test, TestingModule } from '@nestjs/testing';
import { SoilService } from './soil.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('SoilService', () => {
  let service: SoilService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoilService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    service = module.get<SoilService>(SoilService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
