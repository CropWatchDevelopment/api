import { TrafficService } from './traffic.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('TrafficService', () => {
  let service: TrafficService;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders([TrafficService]);

    service = module.get<TrafficService>(TrafficService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
