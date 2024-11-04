import { BadRequestException, Injectable, NotAcceptableException, NotFoundException, NotImplementedException } from '@nestjs/common';
import { CreateDatumDto } from './dto/create-datum.dto';
import { UpdateDatumDto } from './dto/update-datum.dto';
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { CwDeviceTypeService } from 'src/cw_device_type/cw_device_type.service';
import { Database } from 'database.types';
import { DataRepository } from 'src/repositories/data.repository';
import { CwDeviceOwnersService } from 'src/cw_device_owners/cw_device_owners.service';

export interface FindAllParams {
  devEui?: string;
  skip: number;
  take: number;
  order: 'ASC' | 'DESC';
}

@Injectable()
export class DataService {
  constructor(
    private readonly deviceService: CwDevicesService,
    private readonly deviceTypeService: CwDeviceTypeService,
    private readonly deviceOwnerService: CwDeviceOwnersService,
    private readonly dataRepository: DataRepository,
  ) { }

  // create(createDatumDto: CreateDatumDto) {
  //   return new NotImplementedException();
  // }

  async findAll(params: FindAllParams, email: string): Promise<any> {
    const { devEui, skip, take, order } = params;
    this.validateDevEui(devEui);
    await this.validateDeviceOwner(devEui, email);
    const device = await this.getDevice(devEui);
    const deviceTypeData = await this.getDeviceTypeData(device.type);
    return this.dataRepository.findAllByTable(
      deviceTypeData.data_table,
      devEui,
      skip,
      take,
      order === 'ASC'
    );
  }

  private validateDevEui(devEui?: string): void {
    if (!devEui) {
      throw new BadRequestException('DevEui is required');
    }
  }

  private async validateDeviceOwner(devEui: string, email: string): Promise<void> {
    const deviceOwner = await this.deviceOwnerService.getDeviceOwnerByDevEuiAndUID(devEui, email);
    if (!deviceOwner) {
      throw new NotAcceptableException('Device does not exist OR Device Owner not found');
    }
  }

  private async getDevice(devEui: string) {
    const device = await this.deviceService.getDeviceByDevEui(devEui);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    return device;
  }

  private async getDeviceTypeData(deviceType: number) {
    if (!deviceType) {
      throw new NotFoundException('Device type not found');
    }
    const deviceTypeData = await this.deviceTypeService.findById(deviceType);
    if (!deviceTypeData || !deviceTypeData.data_table) {
      throw new NotFoundException('Device type data or data table not found');
    }
    return deviceTypeData;
  }
}
