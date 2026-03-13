import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';
import { BaseDataService } from '../common/base-data.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';

@Injectable()
export class AirService extends BaseDataService<'cw_air_data'> {
  constructor(
    supabaseService: SupabaseService,
    timezoneFormatter: TimezoneFormatterService,
  ) {
    super(supabaseService, timezoneFormatter, 'cw_air_data');
  }

  async createNote(createAirNoteDto: CreateAirAnnotationDto, jwtPayload: any) {
    const normalizedDevEui = createAirNoteDto.dev_eui?.trim();
    if (!normalizedDevEui) {
      throw new BadRequestException('dev_eui is required');
    }
    await this.assertDeviceAccess(normalizedDevEui, jwtPayload);
    const client = this.supabaseService.getClient();
    const resolvedCreatedAt = await this.resolveAnnotationCreatedAt(
      client,
      normalizedDevEui,
      createAirNoteDto.created_at,
    );

    const { data, error } = await client
      .from('cw_air_annotations')
      .insert({
        ...createAirNoteDto,
        created_at: resolvedCreatedAt,
        dev_eui: normalizedDevEui,
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException('Failed to create air annotation');
    }

    return data;
  }

  private async resolveAnnotationCreatedAt(
    client: ReturnType<SupabaseService['getClient']>,
    devEui: string,
    requestedCreatedAt: string,
  ): Promise<string> {
    const { data: exactMatch, error: exactMatchError } = await client
      .from('cw_air_data')
      .select('created_at')
      .eq('dev_eui', devEui)
      .eq('created_at', requestedCreatedAt)
      .maybeSingle();

    if (exactMatchError) {
      throw new InternalServerErrorException(
        'Failed to resolve air data timestamp',
      );
    }

    if (exactMatch?.created_at) {
      return exactMatch.created_at;
    }

    const { rangeEnd, rangeStart } =
      this.getTimestampResolutionWindow(requestedCreatedAt);
    const { data: matches, error: matchError } = await client
      .from('cw_air_data')
      .select('created_at')
      .eq('dev_eui', devEui)
      .gte('created_at', rangeStart)
      .lt('created_at', rangeEnd)
      .order('created_at', { ascending: true })
      .limit(2);

    if (matchError) {
      throw new InternalServerErrorException(
        'Failed to resolve air data timestamp',
      );
    }

    if (!matches?.length) {
      throw new BadRequestException(
        'created_at must match an existing air data reading',
      );
    }

    if (matches.length > 1) {
      throw new BadRequestException(
        'created_at must identify a single air data reading',
      );
    }

    return matches[0].created_at;
  }

  private getTimestampResolutionWindow(createdAt: string): {
    rangeEnd: string;
    rangeStart: string;
  } {
    const parsedCreatedAt = new Date(createdAt);
    if (Number.isNaN(parsedCreatedAt.getTime())) {
      throw new BadRequestException('created_at must be a valid date/time');
    }

    const fractionalSeconds = this.getFractionalSecondDigits(createdAt);
    const resolutionWindowMs =
      fractionalSeconds === 0
        ? 1000
        : 10 ** (3 - Math.min(fractionalSeconds, 3));

    return {
      rangeEnd: new Date(
        parsedCreatedAt.getTime() + resolutionWindowMs,
      ).toISOString(),
      rangeStart: parsedCreatedAt.toISOString(),
    };
  }

  private getFractionalSecondDigits(createdAt: string): number {
    const match = createdAt.match(/\.(\d+)(?=(?:Z|[+-]\d{2}:\d{2})$)/i);
    return match?.[1]?.length ?? 0;
  }
}
