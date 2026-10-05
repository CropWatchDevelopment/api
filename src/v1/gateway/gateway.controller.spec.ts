import { Test, TestingModule } from '@nestjs/testing';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';

describe('GatewayController', () => {
  let controller: GatewayController;
  let gatewayService: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    findByDevice: jest.Mock;
    findDevices: jest.Mock;
  };

  beforeEach(async () => {
    gatewayService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      findByDevice: jest.fn(),
      findDevices: jest.fn(),
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

  it('passes gateway id and authenticated user to the service', () => {
    const user = { sub: 'user-123', email: null, isStaff: false };
    const gateway = { gateway_id: 'gw-001' };
    gatewayService.findOne.mockReturnValue(gateway);

    expect(controller.findOne('gw-001', user)).toBe(gateway);

    expect(gatewayService.findOne).toHaveBeenCalledWith('gw-001', user);
  });

  it('passes the authenticated user to find all gateways', () => {
    const user = { sub: 'user-123', email: null, isStaff: false };
    const gateways = [{ gateway_id: 'gw-001' }];
    gatewayService.findAll.mockReturnValue(gateways);

    expect(controller.findAll(user)).toBe(gateways);

    expect(gatewayService.findAll).toHaveBeenCalledWith(user);
  });

  it('routes by-device before :gatewayId', () => {
    const paths = Object.getOwnPropertyNames(GatewayController.prototype)
      .map(
        (name) =>
          Reflect.getMetadata(
            'path',
            (GatewayController.prototype as unknown as Record<string, object>)[
              name
            ],
          ) as string | undefined,
      )
      .filter((path): path is string => typeof path === 'string');
    expect(paths.indexOf('by-device/:devEui')).toBeLessThan(
      paths.indexOf(':gatewayId'),
    );
  });

  it('delegates by-device and devices', async () => {
    const user = { sub: 'user-123', email: null, isStaff: false };

    await controller.findByDevice('dev-1', user);
    expect(gatewayService.findByDevice).toHaveBeenCalledWith('dev-1', user);

    await controller.findDevices('gw-001', user);
    expect(gatewayService.findDevices).toHaveBeenCalledWith('gw-001', user);
  });
});
