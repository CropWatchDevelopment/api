import { Test, TestingModule } from '@nestjs/testing';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { LocationsService } from '../locations/locations.service';

describe('DevicesController', () => {
  let controller: DevicesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        DevicesService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => null,
            getAdminClient: () => null,
          },
        },
        {
          provide: LocationsService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<DevicesController>(DevicesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
