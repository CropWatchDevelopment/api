import { Test, TestingModule } from '@nestjs/testing';
import { AirController } from './air.controller';
import { AirService } from './air.service';

describe('AirController', () => {
  let controller: AirController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AirController],
      providers: [AirService],
    }).compile();

    controller = module.get<AirController>(AirController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
