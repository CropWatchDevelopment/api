import { Test, TestingModule } from '@nestjs/testing';
import { TrafficController } from './traffic.controller';
import { TrafficService } from './traffic.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('TrafficController', () => {
  let controller: TrafficController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrafficController],
      providers: [
        TrafficService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    controller = module.get<TrafficController>(TrafficController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
