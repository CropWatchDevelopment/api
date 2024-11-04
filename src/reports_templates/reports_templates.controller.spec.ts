import { Test, TestingModule } from '@nestjs/testing';
import { ReportsTemplatesController } from './reports_templates.controller';

describe('ReportsTemplatesController', () => {
  let controller: ReportsTemplatesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsTemplatesController],
    }).compile();

    controller = module.get<ReportsTemplatesController>(ReportsTemplatesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
