import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  CROP_TARGET_PERIODS,
  type CropTargetDto,
  type CropTypeDetailDto,
  type CropTypeDto,
} from './dto/crop-type.dto';

const CROP_TYPE_COLUMNS =
  'id, code, name_en, name_ja, category, cultivation, sort_order';
const CROP_TARGET_COLUMNS =
  'metric, period, unit, min_value, optimal_min, optimal_max, max_value, notes, sources';

type CropTargetRow = Omit<
  CropTargetDto,
  'min_value' | 'optimal_min' | 'optimal_max' | 'max_value' | 'sources'
> & {
  min_value: number | string | null;
  optimal_min: number | string | null;
  optimal_max: number | string | null;
  max_value: number | string | null;
  sources: string[] | null;
};

type CropTypeDetailRow = Omit<CropTypeDetailDto, 'targets'> & {
  cw_crop_targets: CropTargetRow[] | null;
};

/** numeric columns may arrive as strings; anything unreadable is "no value". */
function toNumberOrNull(value: number | string | null): number | null {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTarget(row: CropTargetRow): CropTargetDto {
  return {
    metric: row.metric,
    period: (CROP_TARGET_PERIODS as readonly string[]).includes(row.period)
      ? row.period
      : 'all',
    unit: row.unit,
    min_value: toNumberOrNull(row.min_value),
    optimal_min: toNumberOrNull(row.optimal_min),
    optimal_max: toNumberOrNull(row.optimal_max),
    max_value: toNumberOrNull(row.max_value),
    notes: row.notes ?? null,
    sources: row.sources ?? [],
  };
}

/**
 * Crop types and their growing targets (supabase/updates/037_crop_types.sql).
 * Reference data, the same for every user: a soil sensor's owner picks the
 * crop, and the app judges the sensor's readings against its targets.
 */
@Injectable()
export class CropsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  /** The crops on offer in the picker, in display order. */
  async findAll(): Promise<CropTypeDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_crop_types')
      .select(CROP_TYPE_COLUMNS)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch crop types');
    }
    return data ?? [];
  }

  /**
   * One crop with its targets. A retired crop (is_active false) is still
   * returned, so a sensor already set to it keeps its targets.
   */
  async findOne(id: number): Promise<CropTypeDetailDto> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_crop_types')
      .select(
        `${CROP_TYPE_COLUMNS}, notes, is_active, cw_crop_targets(${CROP_TARGET_COLUMNS})`,
      )
      .eq('id', id)
      .maybeSingle()) as {
      data: CropTypeDetailRow | null;
      error: unknown;
    };

    if (error) {
      throw new InternalServerErrorException('Failed to fetch crop type');
    }
    if (!data) {
      throw new NotFoundException('Crop type not found');
    }

    const { cw_crop_targets: targets, ...crop } = data;
    return {
      ...crop,
      targets: (targets ?? [])
        .map(toTarget)
        .sort(
          (a, b) =>
            a.metric.localeCompare(b.metric) ||
            a.period.localeCompare(b.period),
        ),
    };
  }
}
