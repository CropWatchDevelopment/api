import { Injectable } from '@nestjs/common';
import { CwDevicesService } from 'src/cw_devices/cw_devices.service';
import { DataMetadataService } from 'src/data-metadata/data-metadata.service';
import { DataService, FindAllParams } from 'src/data/data.service';
import { ProfilesService } from 'src/profiles/profiles.service';

@Injectable()
export class ExportService {

    constructor(
        private readonly dataService: DataService,
        private readonly deviceService: CwDevicesService,
        private readonly profileService: ProfilesService,
        private readonly dataMetaDataService: DataMetadataService,
    ) { }

    async getFile(
        user_id: string,
        devEui: string,
        startDate: string,
        endDate: string,
    ): Promise<string> {
        const start = new Date(startDate);
        const end = new Date(endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        if (start > end) {
            throw new Error('Start date cannot be after end date.');
        }
        const device = await this.deviceService.getDeviceByDevEui(devEui);
        if (!device) {
            throw new Error('Device not found');
        }
        const profile = await this.profileService.findOne(user_id);
        if (!profile) {
            throw new Error('Profile not found');
        }

        const dataMetadata = await this.dataMetaDataService.getDeviceByDevEui(device.type);

        const findParams: FindAllParams = {
            devEui: device.dev_eui,
            skip: 0,
            take: 20000,
            order: 'DESC',
            start: start,
            end: end,
        };
        const data = await this.dataService.findAllBetweenDateTimeRange(findParams, user_id);
        if (!data) {
            throw new Error('Data not found');
        }
        // only return properties of data object array that are in the metadata
        const filteredData = data.map((d) => {
            const filtered = {};
            dataMetadata.forEach((meta) => {
                if (d[meta.name]) {
                    filtered[meta.name] = d[meta.name];
                }
            });
            return filtered;
        });
        // convert data to CSV
        const csv = this.jsonToCsv(filteredData);
        return csv;
    }

    private jsonToCsv(jsonArray, delimiter = ",") {
        if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
            throw new Error("Input must be a non-empty array.");
        }

        // Extract headers (keys from the first object)
        const headers = Object.keys(jsonArray[0]);

        // Map each object to a CSV row
        const csvRows = jsonArray.map(obj =>
            headers.map(fieldName =>
                `"${(obj[fieldName] !== undefined && obj[fieldName] !== null) ? obj[fieldName] : ''}"`
            ).join(delimiter)
        );

        // Combine headers and rows
        return [headers.join(delimiter), ...csvRows].join("\n");
    }

}
