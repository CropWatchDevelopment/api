import { Test, TestingModule } from '@nestjs/testing';
import { DataMetadataController } from './data-metadata.controller';

describe('DataMetadataController', () => {
  let controller: DataMetadataController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataMetadataController],
    }).compile();

    controller = module.get<DataMetadataController>(DataMetadataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
