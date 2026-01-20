import { TrafficController } from './traffic.controller';
import { TrafficService } from './traffic.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('TrafficController', () => {
  let controller: TrafficController;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders(
      [TrafficService],
      [TrafficController],
    );

    controller = module.get<TrafficController>(TrafficController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
