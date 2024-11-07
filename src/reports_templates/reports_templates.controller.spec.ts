import { Test, TestingModule } from '@nestjs/testing';
import { ReportsTemplatesController } from './reports_templates.controller';
import { ReportsTemplatesService } from './reports_templates.service';

describe('ReportsTemplatesController', () => {
  let controller: ReportsTemplatesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsTemplatesController],
      providers: [
        {
          provide: ReportsTemplatesService,
          useValue: {
            // Mock methods here as needed
            findAll: jest.fn(),
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportsTemplatesController>(ReportsTemplatesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
