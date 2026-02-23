import { AirController } from './air.controller';
import { AirService } from './air.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('AirController', () => {
  let controller: AirController;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders(
      [AirService],
      [AirController],
    );

    controller = module.get<AirController>(AirController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
