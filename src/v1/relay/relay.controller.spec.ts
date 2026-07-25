import { Test, TestingModule } from '@nestjs/testing';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

describe('RelayController', () => {
  let controller: RelayController;
  let relayService: {
    getLatestRelay: jest.Mock;
    handleTtiUp: jest.Mock;
    pulseRelay: jest.Mock;
    updateRelay: jest.Mock;
  };

  beforeEach(async () => {
    relayService = {
      getLatestRelay: jest.fn(),
      handleTtiUp: jest.fn(),
      pulseRelay: jest.fn(),
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
    void controller.handleTtiUp({ uplink_message: {} }, undefined, 'tti-token');

    expect(relayService.handleTtiUp).toHaveBeenCalledWith(
      { uplink_message: {} },
      undefined,
      'tti-token',
    );
  });

  it('forwards latest relay lookups to the relay service', () => {
    const user = {
      email: 'user@example.com',
      isStaff: false,
      sub: 'user-1',
    };

    void controller.getLatestRelay('A8404194635A05FB', user);

    expect(relayService.getLatestRelay).toHaveBeenCalledWith(
      user,
      'A8404194635A05FB',
    );
  });

  it('forwards timed relay pulse requests to the relay service', () => {
    const user = {
      email: 'user@example.com',
      isStaff: false,
      sub: 'user-1',
    };

    void controller.pulseRelay(
      'A8404194635A05FB',
      {
        durationSeconds: 60,
        relay: 1,
      },
      user,
    );

    expect(relayService.pulseRelay).toHaveBeenCalledWith(
      user,
      'A8404194635A05FB',
      {
        durationSeconds: 60,
        relay: 1,
      },
    );
  });
});
