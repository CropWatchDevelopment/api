import { Test, TestingModule } from '@nestjs/testing';
import { DataService } from './data.service';
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { CwDeviceTypeService } from 'src/cw_device_type/cw_device_type.service';
import { CwDeviceOwnersService } from 'src/cw_device_owners/cw_device_owners.service';
import { DataRepository } from 'src/repositories/data.repository';
import { BadRequestException, NotAcceptableException, NotFoundException } from '@nestjs/common';

describe('DataService', () => {
  let service: DataService;
  let mockDeviceService: CwDevicesService;
  let mockDeviceTypeService: CwDeviceTypeService;
  let mockDeviceOwnerService: CwDeviceOwnersService;
  let mockDataRepository: DataRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataService,
        { provide: CwDevicesService, useValue: { getDeviceByDevEui: jest.fn() } },
        { provide: CwDeviceTypeService, useValue: { findById: jest.fn() } },
        { provide: CwDeviceOwnersService, useValue: { getDeviceOwnerByDevEuiAndUID: jest.fn() } },
        { provide: DataRepository, useValue: { findAllByTable: jest.fn() } },
      ],
    }).compile();

    service = module.get<DataService>(DataService);
    mockDeviceService = module.get<CwDevicesService>(CwDevicesService);
    mockDeviceTypeService = module.get<CwDeviceTypeService>(CwDeviceTypeService);
    mockDeviceOwnerService = module.get<CwDeviceOwnersService>(CwDeviceOwnersService);
    mockDataRepository = module.get<DataRepository>(DataRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should throw BadRequestException if devEui is not provided', async () => {
      await expect(service.findAll({ devEui: undefined, skip: 0, take: 10, order: 'ASC' }, 'user@example.com')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotAcceptableException if device owner is not found', async () => {
      jest.spyOn(mockDeviceOwnerService, 'getDeviceOwnerByDevEuiAndUID').mockResolvedValue(null);

      await expect(service.findAll({ devEui: 'mock-devEui', skip: 0, take: 10, order: 'ASC' }, 'user@example.com')).rejects.toThrow(
        NotAcceptableException,
      );
    });

    it('should return data from the repository', async () => {
      jest.spyOn(mockDeviceOwnerService, 'getDeviceOwnerByDevEuiAndUID').mockResolvedValue({
        dev_eui: 'mock-devEui',
        id: 1,
        owner_id: 1,
        permission_level: 2,
        user_id: 'mock-user-id',
      });
      jest.spyOn(mockDeviceService, 'getDeviceByDevEui').mockResolvedValue({
        type: 1,
        dev_eui: 'mock-devEui',
        ai_provider: 'mock-provider',
        battery_changed_at: '2023-11-07',
        installed_at: '2023-11-01',
        lat: 35.0,
        location_id: 1,
        long: 139.0,
        name: 'Mock Device',
        report_endpoint: 'mock-endpoint',
        serial_number: '123456',
        upload_interval: 10,
        user_id: 'mock-user-id',
        warranty_start_date: '2023-10-01',
      });
      jest.spyOn(mockDeviceTypeService, 'findById').mockResolvedValue({
        created_at: '2023-11-07',
        data_table: 'mock_table',
        decoder: 'mock_decoder',
        default_upload_interval: 10,
        device_app: 'mock_app',
        id: 1,
        manufacturer: 'Mock Manufacturer',
        model: 'Mock Model',
        name: 'Mock Device Type',
        primary_data: 'mock_primary_data',
        primary_multiplier: 1,
        primary_data_notation: 'mock_primary_data_notation',
        primary_divider: 1,
        secondary_data: 'mock_secondary_data',
        secondary_multiplier: 1,
        secondary_data_notation: 'mock_secondary_data_notation',
        secondary_divider: 1,
      });
      
      jest.spyOn(mockDataRepository, 'findAllByTable').mockResolvedValue([{ data: 'mockData' }]);

      const result = await service.findAll({ devEui: 'mock-devEui', skip: 0, take: 10, order: 'ASC' }, 'user@example.com');
      expect(result).toEqual([{ data: 'mockData' }]);
    });
  });
});
