import { Test, TestingModule } from '@nestjs/testing';
import { DataController } from './data.controller';
import { DataService } from './data.service';
import { CwDevicesService } from '../cw_devices/cw_devices.service';
import { CwDeviceTypeService } from '../cw_device_type/cw_device_type.service';

describe('DataController', () => {
  let controller: DataController;
  let mockDataService: Partial<DataService>;

  const mockRequest = {
    user: { id: 'mock-user-id' },
  };

  const mockQuery = {
    DevEui: 'mock-dev-eui',
    Skip: 0,
    Take: 10,
    Order: 'ASC' as 'ASC' | 'DESC', // Explicitly cast to correct type
  };

  beforeEach(async () => {
    mockDataService = {
      findAll: jest.fn().mockResolvedValue('mockData'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataController],
      providers: [
        { provide: DataService, useValue: mockDataService },
        { provide: CwDevicesService, useValue: {} },
        { provide: CwDeviceTypeService, useValue: {} },
      ],
    }).compile();

    controller = module.get<DataController>(DataController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return data with filters and pagination', async () => {
    const result = await controller.findAll(
      mockRequest,
      mockQuery.DevEui,
      mockQuery.Skip,
      mockQuery.Take,
      mockQuery.Order,
    );

    expect(result).toEqual('mockData');
    expect(mockDataService.findAll).toHaveBeenCalledWith(
      { devEui: mockQuery.DevEui, skip: mockQuery.Skip, take: mockQuery.Take, order: mockQuery.Order },
      mockRequest.user.id,
    );
  });

  it('should return "Unauthorized" if no user is found in request', async () => {
    const result = await controller.findAll(
      { user: null }, // No user in request
      mockQuery.DevEui,
      mockQuery.Skip,
      mockQuery.Take,
      mockQuery.Order,
    );

    expect(result).toBe('Unauthorized');
  });
});
