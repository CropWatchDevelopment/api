import { Test, TestingModule } from '@nestjs/testing';
import { RelayController, RelayState } from './relay.controller';
import { RelayService } from './relay.service';

describe('RelayController', () => {
  let controller: RelayController;
  let service: RelayService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RelayController],
      providers: [
        {
          provide: RelayService,
          useValue: {
            sendDownlink: jest.fn().mockResolvedValue('Mocked Downlink Response'),
          },
        },
      ],
    }).compile();

    controller = module.get<RelayController>(RelayController);
    service = module.get<RelayService>(RelayService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProtectedRoute', () => {
    it('should call sendDownlink with correct parameters and return a response', async () => {
      const deviceId = 'device123';
      const state = RelayState.Open;
      const mockRequest = { user: { id: 'user1' } };

      const result = await controller.getProtectedRoute(deviceId, state, mockRequest);

      expect(service.sendDownlink).toHaveBeenCalledWith(true, deviceId);
      expect(result).toEqual({
        message: 'Relay state updated',
        response: 'Mocked Downlink Response',
      });
    });

    it('should call sendDownlink with "false" when state is Close', async () => {
      const deviceId = 'device123';
      const state = RelayState.Close;
      const mockRequest = { user: { id: 'user1' } };

      const result = await controller.getProtectedRoute(deviceId, state, mockRequest);

      expect(service.sendDownlink).toHaveBeenCalledWith(false, deviceId);
      expect(result).toEqual({
        message: 'Relay state updated',
        response: 'Mocked Downlink Response',
      });
    });
  });
});
