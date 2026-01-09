import { Test, TestingModule } from '@nestjs/testing';
import { WaterController } from './water.controller';
import { WaterService } from './water.service';

describe('WaterController', () => {
  let controller: WaterController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WaterController],
      providers: [WaterService],
    }).compile();

    controller = module.get<WaterController>(WaterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
