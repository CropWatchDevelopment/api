import { Injectable } from '@nestjs/common';
import { DataService, FindAllParams } from 'src/data/data.service';
import moment from 'moment';

// PDF Parts Import stuff
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { buildCO2Report } from './PdfTemplateTypes/Co2Report';
import { LocationService } from 'src/location/location.service';
import { ProfilesService } from 'src/profiles/profiles.service';
import { TableColorRange } from './interfaces/TableColorRange';
import { buildColdChainReport } from './PdfTemplateTypes/ColdChain';


@Injectable()
export class PdfService {
  constructor(
    private readonly dataService: DataService,
    private readonly deviceService: CwDevicesService,
    private readonly locationService: LocationService,
    private readonly profileService: ProfilesService
  ) { }

  public async createPdfBinary(user_id: string, devEui: string, start: Date, end: Date): Promise<Buffer> {
    if (!user_id) throw new Error('User ID is required');
    if (!devEui) throw new Error('DevEui is required');
    let rawData = await this.fetchDataAndReportFromDB(devEui, user_id, start, end);
    let device = await this.deviceService.getDeviceByDevEui(devEui);
    let location = await this.locationService.findById(device.location_id, 'location_id');
    let profile = await this.profileService.findOne(device.user_id);

    const reportUserData = {
      dev_eui: device.dev_eui,
      company: profile.employer,
      department: '--',
      location: location.name,
      deviceName: device.name,
      timeSpan: `${moment(start).format('YYYY/MM/DD').toString()} - ${moment(end).format('YYYY/MM/DD').toString()}`
    };

    if (device.report_endpoint.includes('cold-storage')) {
      const tableColorRange: TableColorRange[] = [
        { name: 'alert', min: 0, max: 9999, color: 'red' },
        { name: 'warning', min: -15.1, max: 0, color: 'orange' },
        { name: 'notice', min: -17.99, max: -15.1, color: 'yellow' },
        { name: 'normal', min: -18, max: -1000, color: 'white' }
      ];
      return await buildColdChainReport(rawData, tableColorRange, reportUserData);
    } else if (device.report_endpoint.includes('co2-report')) {
      return await buildCO2Report(
        rawData,
        device.dev_eui,
        profile.employer,
        '--',
        location.name,
        device.name,
        `${moment(start).format('YYYY/MM/DD').toString()} - ${moment(end).format('YYYY/MM/DD').toString()}`,
      );
    } else {
      throw new Error('Report endpoint not setup for this device');
    }
  }




  private async fetchDataAndReportFromDB(devEui: string, user_id: string, start: Date, end: Date) {
    const findAllParams: FindAllParams = {
      devEui,
      skip: 0,
      take: 10,
      order: 'ASC',
      start,
      end,
    };
    const reportData = await this.dataService.findAllBetweenDateTimeRange(
      findAllParams,
      user_id
    );
    return reportData;
  }
}
