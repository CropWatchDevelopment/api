import { Test, TestingModule } from '@nestjs/testing';
import { TrafficService } from './traffic.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('TrafficService', () => {
  let service: TrafficService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrafficService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    service = module.get<TrafficService>(TrafficService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
