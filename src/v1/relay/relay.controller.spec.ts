import { Test, TestingModule } from '@nestjs/testing';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

describe('RelayController', () => {
  let controller: RelayController;
  let relayService: {
    handleTtiUp: jest.Mock;
    updateRelay: jest.Mock;
  };

  beforeEach(async () => {
    relayService = {
      handleTtiUp: jest.fn(),
      updateRelay: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RelayController],
      providers: [
        {
          provide: RelayService,
          useValue: relayService,
        },
      ],
    }).compile();

    controller = module.get<RelayController>(RelayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards the TTI downlink API key header to the relay service', () => {
    controller.handleTtiUp({ uplink_message: {} }, undefined, 'tti-token');

    expect(relayService.handleTtiUp).toHaveBeenCalledWith(
      { uplink_message: {} },
      undefined,
      'tti-token',
    );
  });
});
