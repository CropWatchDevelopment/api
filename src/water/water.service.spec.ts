import { Test, TestingModule } from '@nestjs/testing';
import { WaterService } from './water.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('WaterService', () => {
  let service: WaterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WaterService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    service = module.get<WaterService>(WaterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
