import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req } from '@nestjs/common';
import { DataService } from './data.service';
import { CreateDatumDto } from './dto/create-datum.dto';
import { UpdateDatumDto } from './dto/update-datum.dto';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CwDeviceTypeService } from '../cw_device_type/cw_device_type.service';
import { CwDevicesService } from '../cw_devices/cw_devices.service';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('data')
@ApiTags('CRUD operations for data related to devices rigistered to current JWT')
export class DataController {
  constructor(
    private readonly dataService: DataService,
    private readonly deviceService: CwDevicesService,
    private readonly deviceTypeService: CwDeviceTypeService,
  ) { }

  // @Post()
  // create(@Body() createDatumDto: CreateDatumDto) {
  //   return this.dataService.create(createDatumDto);
  // }

  @ApiOperation({ summary: 'Retrieve data with filters and pagination' })
  @ApiQuery({ name: 'DevEui', required: false, type: String, description: 'Device EUI to filter data by specific device.' })
  @ApiQuery({ name: 'Skip', required: false, type: Number, description: 'Number of records to skip. (default: 0)' })
  @ApiQuery({ name: 'Take', required: false, type: Number, description: 'Number of records to retrieve. (default: 10)' })
  @ApiQuery({ name: 'Order', required: false, type: String, description: 'Created_At Order direction, either ASC or DESC.' })
  @ApiBearerAuth('JWT')
  @Get()
  findAll(
    @Req() req,
    @Query('DevEui') devEui?: string,
    @Query('Skip') skip = 0,
    @Query('Take') take = 10,
    @Query('Order') order: 'ASC' | 'DESC' = 'ASC'
  ) {
    if (!req.user) {
      return 'Unauthorized';
    }
    return this.dataService.findAll({ devEui, skip, take, order }, req.user.id);
  }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.dataService.findOne(+id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateDatumDto: UpdateDatumDto) {
  //   return this.dataService.update(+id, updateDatumDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.dataService.remove(+id);
  // }
}
