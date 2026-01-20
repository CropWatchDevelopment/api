import { SoilService } from './soil.service';
import { createTestingModuleWithCommonProviders } from '../common/test-helpers';

describe('SoilService', () => {
  let service: SoilService;

  beforeEach(async () => {
    const module = await createTestingModuleWithCommonProviders([SoilService]);

    service = module.get<SoilService>(SoilService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
