import { Test, TestingModule } from '@nestjs/testing';
import { AirService } from './air.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('AirService', () => {
  let service: AirService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    service = module.get<AirService>(AirService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
