import { Test, TestingModule } from '@nestjs/testing';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

describe('RelayController', () => {
  let controller: RelayController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RelayController],
      providers: [
        {
          provide: RelayService,
          useValue: {
            handleTtiUp: jest.fn(),
            updateRelay: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<RelayController>(RelayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
