import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AccessService, Action } from '../common/authz';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import type {
  AiRecommendationDto,
  AiReportType,
} from './dto/ai-recommendation.dto';

// Everything the app shows; the per-metric stats (metrics) and the model and
// rules provenance stay in the table for audits.
const COLUMNS =
  'id, dev_eui, report_type, period_start, period_end, timezone, status, max_severity, ' +
  'findings, details, headline_ja, body_ja, headline_en, body_en, text_source, created_at, updated_at';

/** Growing-environment reports for a soil sensor (cw_ai_recommendations). */
@Injectable()
export class AiRecommendationsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * The device's newest reports of one type, newest period first. Readable by
   * whoever may read the device's data; 404 when the device is invisible to
   * the caller (never reveals that it exists).
   */
  async findForDevice(
    user: AuthenticatedUser,
    devEui: string,
    reportType: AiReportType,
    limit: number,
  ): Promise<AiRecommendationDto[]> {
    await this.accessService.assertDeviceAccess(user, devEui, Action.DataRead);

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_ai_recommendations')
      .select(COLUMNS)
      .eq('dev_eui', devEui)
      .eq('report_type', reportType)
      .order('period_start', { ascending: false })
      .limit(limit);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to fetch AI recommendations',
      );
    }
    return (data ?? []) as unknown as AiRecommendationDto[];
  }
}
