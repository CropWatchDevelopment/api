import { WaterController } from './water.controller';
import { WaterService } from './water.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('WaterController', () => {
  let controller: WaterController;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders(
      [WaterService],
      [WaterController],
    );

    controller = module.get<WaterController>(WaterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
