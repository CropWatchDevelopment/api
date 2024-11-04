import { BadRequestException, Injectable, NotAcceptableException, NotFoundException, NotImplementedException, Req } from '@nestjs/common';
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

  create(createDatumDto: CreateDatumDto) {
    return new NotImplementedException();
  }

  async findAll(params: FindAllParams, email: string): Promise<any> {
    const { devEui, skip, take, order } = params;
    if (!devEui) {
      return new BadRequestException('DevEui is required');
    }
    const deviceOwner = await this.deviceOwnerService.getDeviceOwnerByDevEuiAndUID(devEui, email);
    if (!deviceOwner) {
      return new NotAcceptableException('Device does not exist OR Device Owner not found');
    }
    const device = await this.deviceService.getDeviceByDevEui(devEui);
    if (!device) {
      return new NotFoundException('Device not found');
    }
    const deviceType = device.type;
    if (!deviceType) {
      throw new NotFoundException('Device type not found');
    }
    const deviceTypeData = await this.deviceTypeService.findById(deviceType);
    if (!deviceTypeData) {
      throw new NotFoundException('Device type data not found');
    }
    const data_table: string = deviceTypeData.data_table;
    if (!data_table) {
      throw new NotFoundException('Data table not found');
    }
    //Data_table will contain the name of the datatable to query in the repo
    const data = this.dataRepository.findAllByTable(data_table, devEui, skip, take, order == 'ASC' ? true : false);
    return data;
  }

  findOne(id: number) {
    return new NotImplementedException();
  }

  update(id: number, updateDatumDto: UpdateDatumDto) {
    return new NotImplementedException();
  }

  remove(id: number) {
    return new NotImplementedException();
  }
}
