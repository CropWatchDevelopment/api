import { Injectable, Req } from '@nestjs/common';
import { CreateDatumDto } from './dto/create-datum.dto';
import { UpdateDatumDto } from './dto/update-datum.dto';
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { CwDeviceTypeService } from 'src/cw_device_type/cw_device_type.service';
import { Database } from 'database.types';
import { DataRepository } from 'src/repositories/data.repository';
import { CwDeviceOwnersService } from 'src/cw_device_owners/cw_device_owners.service';


interface FindAllParams {
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
  ) {}

  create(createDatumDto: CreateDatumDto) {
    return 'This action adds a new datum';
  }

  async findAll(params: FindAllParams, email: string) {
    const { devEui, skip, take, order } = params;
    if (!devEui) {
      return 'DevEui is required';
    }
    const deviceOwner = await this.deviceOwnerService.getDeviceOwnerByDevEuiAndEmail(devEui, '');
    if (!deviceOwner) {
      return 'Device does not exist OR Device Owner not found';
    }
    const device = await this.deviceService.getDeviceByDevEui(devEui);
    if (!device) {
      return 'Device not found';
    }
    const deviceType = device.type;
    if (!deviceType) {
      return 'Device type not found';
    }
    const deviceTypeData = await this.deviceTypeService.findById(deviceType);
    if (!deviceTypeData) {
      return 'Device type data not found';
    }
    const data_table: string = deviceTypeData.data_table;
    if (!data_table) {
      return 'Data table not found';
    }
    //Data_table will contain the name of the datatable to query in the repo
    const data = this.dataRepository.findAllByTable(data_table, devEui, skip, take, order == 'ASC' ? true : false);
    return data;
  }

  findOne(id: number) {
    return `This action returns a #${id} datum`;
  }

  update(id: number, updateDatumDto: UpdateDatumDto) {
    return `This action updates a #${id} datum`;
  }

  remove(id: number) {
    return `This action removes a #${id} datum`;
  }
}
