import { Test, TestingModule } from '@nestjs/testing';
import { DataMetadataService } from './data-metadata.service';

describe('DataMetadataService', () => {
  let service: DataMetadataService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataMetadataService],
    }).compile();

    service = module.get<DataMetadataService>(DataMetadataService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
