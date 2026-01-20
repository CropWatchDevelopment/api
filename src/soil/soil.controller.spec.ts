import { Test, TestingModule } from '@nestjs/testing';
import { SoilController } from './soil.controller';
import { SoilService } from './soil.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

describe('SoilController', () => {
  let controller: SoilController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SoilController],
      providers: [
        SoilService,
        { provide: SupabaseService, useValue: {} },
        TimezoneFormatterService,
      ],
    }).compile();

    controller = module.get<SoilController>(SoilController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
