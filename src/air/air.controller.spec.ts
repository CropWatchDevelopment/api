import { Test, TestingModule } from '@nestjs/testing';
import { AirController } from './air.controller';
import { AirService } from './air.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('AirController', () => {
  let controller: AirController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AirController],
      providers: [
        AirService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    controller = module.get<AirController>(AirController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
