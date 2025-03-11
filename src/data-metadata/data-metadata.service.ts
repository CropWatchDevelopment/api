import { Injectable } from '@nestjs/common';
import { BaseService } from '../bases/base.service';
import { cw_data_metadataRow } from '../common/database-types';
import { DataMetadataRepository } from 'src/repositories/cw_data_metadata.repository';
import { CreateMetadataDto } from './dto/create-metadata.dto';
import { UpdateMetadataDto } from './dto/update-metadata.dto';

@Injectable()
export class DataMetadataService extends BaseService<cw_data_metadataRow, CreateMetadataDto, UpdateMetadataDto> {
  constructor(private readonly metaDataRepository: DataMetadataRepository) {
    super(metaDataRepository);
  }

  public async getDeviceByDevEui(typeId: number): Promise<cw_data_metadataRow[]> {
    return this.metaDataRepository.findByDeviceTypeId({ typeId: typeId });
  }

}