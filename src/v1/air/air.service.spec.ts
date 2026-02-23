import { AirService } from './air.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('AirService', () => {
  let service: AirService;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders([AirService]);

    service = module.get<AirService>(AirService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
