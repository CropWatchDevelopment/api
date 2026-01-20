import { SoilController } from './soil.controller';
import { SoilService } from './soil.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('SoilController', () => {
  let controller: SoilController;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders(
      [SoilService],
      [SoilController],
    );

    controller = module.get<SoilController>(SoilController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
