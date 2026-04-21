import { Test, TestingModule } from '@nestjs/testing';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';

describe('GatewayController', () => {
  let controller: GatewayController;
  let gatewayService: { findAll: jest.Mock; findOne: jest.Mock };

  beforeEach(async () => {
    gatewayService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GatewayController],
      providers: [{ provide: GatewayService, useValue: gatewayService }],
    }).compile();

    controller = module.get<GatewayController>(GatewayController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes gateway id and authenticated request data to the service', () => {
    const gateway = { gateway_id: 'gw-001' };
    gatewayService.findOne.mockReturnValue(gateway);

    expect(
      controller.findOne('gw-001', {
        user: { sub: 'user-123' },
        headers: { authorization: 'Bearer access-token' },
      }),
    ).toBe(gateway);

    expect(gatewayService.findOne).toHaveBeenCalledWith('gw-001', {
      sub: 'user-123',
    });
  });

  it('passes authenticated request data to find all gateways', () => {
    const gateways = [{ gateway_id: 'gw-001' }];
    gatewayService.findAll.mockReturnValue(gateways);

    expect(
      controller.findAll({
        user: { sub: 'user-123' },
        headers: { authorization: 'Bearer access-token' },
      }),
    ).toBe(gateways);

    expect(gatewayService.findAll).toHaveBeenCalledWith({ sub: 'user-123' });
  });
});
