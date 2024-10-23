import { Test, TestingModule } from '@nestjs/testing';
import { RepositoryBaseService } from './repository-base.service';

describe('RepositoryBaseService', () => {
  let service: RepositoryBaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RepositoryBaseService],
    }).compile();

    service = module.get<RepositoryBaseService>(RepositoryBaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
