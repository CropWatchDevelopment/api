import { WaterService } from './water.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('WaterService', () => {
  let service: WaterService;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders([WaterService]);

    service = module.get<WaterService>(WaterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
