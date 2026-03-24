import { BadRequestException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { ReportDto } from './dto/report.dto';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';

export interface ReportHistoryBucket {
  id: string;
  name: string;
  owner: string;
  public: boolean;
  created_at: string;
  updated_at: string;
  type?: string;
  file_size_limit?: number;
  allowed_mime_types?: string[];
}

export interface ReportHistoryItem {
  name: string;
  bucket_id: string;
  owner: string;
  id: string;
  updated_at: string;
  created_at: string;
  last_accessed_at: string;
  metadata: Record<string, unknown>;
  buckets: ReportHistoryBucket;
}

export type ReportHistoryList = ReportHistoryItem[] | null;

@Injectable()
export class ReportsService {

  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  async create(createReportDto: CreateReportDto, jwtPayload: any, authHeader: string): Promise<ReportDto> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);
    const reportSelect = '*, report_recipients(*), report_user_schedule(*), report_alert_points(*)';

    delete createReportDto.id; // Ensure ID is not set by client
    delete createReportDto.created_at; // Ensure created_at is not set by client
    delete createReportDto.report_id; // Ensure report_id is not set by client

    for (const point of createReportDto.report_alert_points ?? []) {
      delete point.id; // Ensure alert point IDs are not set by client
    }

    for (const schedule of createReportDto.report_user_schedule ?? []) {
      delete schedule.id; // Ensure user schedule IDs are not set by client
    }

    for (const recipient of createReportDto.report_recipients ?? []) {
      delete recipient.id; // Ensure recipient IDs are not set by client
    }

    createReportDto.user_id = userId; // Ensure the report is associated with the authenticated user

    // Split each dto into seperate objects by table:
    const { report_user_schedule, report_alert_points, report_recipients, ...reportData } = createReportDto;

    const { data: createdReport, error } = await client
      .from('reports')
      .insert(reportData)
      .select('*')
      .single();

    if (error || !createdReport) {
      throw new InternalServerErrorException('Failed to create report');
    }

    const reportId = createdReport.report_id;

    try {
      for (const point of report_alert_points ?? []) {
        const { error: insertError } = await client
          .from('report_alert_points')
          .insert({
            ...point,
            report_id: reportId,
            user_id: userId,
          });

        if (insertError) {
          throw insertError;
        }
      }

      for (const schedule of report_user_schedule ?? []) {
        const { error: insertError } = await client
          .from('report_user_schedule')
          .insert({
            ...schedule,
            dev_eui: reportData.dev_eui,
            report_id: reportId,
            user_id: userId,
          });

        if (insertError) {
          throw insertError;
        }
      }

      for (const recipient of report_recipients ?? []) {
        const { error: insertError } = await client
          .from('report_recipients')
          .insert({
            ...recipient,
            report_id: reportId,
            user_id: userId,
          });

        if (insertError) {
          throw insertError;
        }
      }
    } catch {
      await client.from('report_alert_points').delete().eq('report_id', reportId);
      await client.from('report_user_schedule').delete().eq('report_id', reportId);
      await client.from('report_recipients').delete().eq('report_id', reportId);
      await client.from('reports').delete().eq('report_id', reportId);
      throw new InternalServerErrorException('Failed to create report');
    }

    const { data, error: fetchError } = await client
      .from('reports')
      .select(reportSelect)
      .eq('report_id', reportId)
      .single();

    if (fetchError || !data) {
      throw new InternalServerErrorException('Failed to create report');
    }

    return data;
  }

  async findAll(jwtPayload: any, authHeader: string): Promise<ReportDto[]> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const client = this.supabaseService.getClient(accessToken);

    let query = client
      .from('reports')
      .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*), cw_devices(name, dev_eui, cw_device_owners(*), cw_locations(name, location_id))')
      .order('name', { ascending: true });

    // if (!isGlobalUser) {
    //   query = query.eq('user_id', userId)
    // }

    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch reports');
    }



    const rulesWhereIAmOwnerOrCollaborator = data.map((report) => {
      if (report.user_id === userId) {
        return {
          permission_level: 1, // Owner has highest permission level
          ...report,
        };
      } else {
        const colabEntry = report.cw_devices?.cw_device_owners?.find(
          (owner) => owner.user_id === userId && owner.permission_level <= 3,
        );
        if (colabEntry) {
          return {
            permission_level: colabEntry.permission_level,
            ...report,
          }
        }
      }
    }).filter((report) => report != null);




      return rulesWhereIAmOwnerOrCollaborator;
    }

  async findAllHistory(dev_eui: string, jwtPayload: any, authHeader: string): Promise < ReportHistoryList > {
      const userId = getUserId(jwtPayload);
      const accessToken = getAccessToken(authHeader);
      const isGlobalUser = isCropwatchStaff(jwtPayload);
      const client = this.supabaseService.getClient(accessToken);

      let permissionQuery = client
        .from('reports')
        .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
        .order('created_at', { ascending: false })
        .eq('dev_eui', dev_eui);

      if(!isGlobalUser) {
        permissionQuery = permissionQuery.eq('user_id', userId);
      }

    const { data: permissionData, error: permissionError } = await permissionQuery;
      if(permissionError) {
        throw new InternalServerErrorException('Failed to fetch report history');
      }

    const { data, error } = await client
        .storage
        .from('Reports')
        .list(dev_eui, {
          limit: 110,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        })

    return data;
    }

  async downloadReport(dev_eui: string, report_id: string, jwtPayload: any, authHeader: string): Promise < { url: string } | null > {
      const userId = getUserId(jwtPayload);
      const accessToken = getAccessToken(authHeader);
      const isGlobalUser = isCropwatchStaff(jwtPayload);
      const client = this.supabaseService.getClient(accessToken);
      const adminClient = this.supabaseService.getAdminClient();
      const normalizedDevEui = dev_eui?.trim();
      const normalizedReportId = report_id?.trim();
      const dbReportId = normalizedReportId?.replace(/\.pdf$/i, '');

      if(!normalizedDevEui || !normalizedReportId || !dbReportId) {
        throw new BadRequestException('dev_eui and report_id are required');
  }

    let permissionQuery = client
  .from('reports')
  .select('id')
  .eq('dev_eui', normalizedDevEui)
  .limit(1);

if (!isGlobalUser) {
  permissionQuery = permissionQuery.eq('user_id', userId);
}

const { data: permissionData, error: permissionError } = await permissionQuery;
if (permissionError) {
  throw new InternalServerErrorException('Failed to fetch report for download');
}
if (!permissionData?.length) {
  throw new UnauthorizedException('User does not have permission to download this report');
}

const storageClient = adminClient ?? client;
const bucketCandidates = ['Reports', 'reports'];
const candidatePaths = Array.from(new Set(
  normalizedReportId.toLowerCase().endsWith('.pdf')
    ? [`${normalizedDevEui}/${normalizedReportId}`, `${normalizedDevEui}/${dbReportId}.pdf`]
    : [`${normalizedDevEui}/${normalizedReportId}`, `${normalizedDevEui}/${normalizedReportId}.pdf`],
));

let lastStorageError: unknown = null;
for (const bucket of bucketCandidates) {
  for (const path of candidatePaths) {
    const { data, error } = await storageClient
      .storage
      .from(bucket)
      .createSignedUrl(path, 60, { download: true });

    if (!error && data?.signedUrl) {
      return { url: data.signedUrl };
    }

    lastStorageError = error;
  }
}

console.error('Failed to generate report signed URL', {
  dev_eui: normalizedDevEui,
  report_id: dbReportId,
  error: lastStorageError,
});
throw new InternalServerErrorException('Failed to generate report download URL');
  }


  async findOne(report_id: string, jwtPayload: any, authHeader: string): Promise < ReportDto > {
  const userId = getUserId(jwtPayload);
  const accessToken = getAccessToken(authHeader);
  const isGlobalUser = isCropwatchStaff(jwtPayload);
  const client = this.supabaseService.getClient(accessToken);

  let query = client
    .from('reports')
    .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
    .order('name', { ascending: true })
    .eq('report_id', report_id);

  if(!isGlobalUser) {
    query = query.eq('user_id', userId);
  }

    const { data, error } = await query.single();
  if(error) {
    throw new InternalServerErrorException('Failed to fetch report');
  }

    return data;
}

  async update(report_id: string, updateReportDto: UpdateReportDto, jwtPayload: any, authHeader: string): Promise < ReportDto > {
  const userId = getUserId(jwtPayload);
  const accessToken = getAccessToken(authHeader);
  const isGlobalUser = isCropwatchStaff(jwtPayload);
  const client = this.supabaseService.getClient(accessToken);

  const hasPermission = await this.hasPermissionToReport(userId, report_id, accessToken, isGlobalUser);
  if(!hasPermission) {
    throw new UnauthorizedException('User does not have permission to update this report');
  }

    // Strip fields the client should not control
    delete updateReportDto.id;
  delete updateReportDto.created_at;
  delete updateReportDto.report_id;

  // Separate child relations from core report data
  const { report_user_schedule, report_alert_points, report_recipients, ...reportData } = updateReportDto;

  if(!isGlobalUser) {
    const { data: existingReport, error: fetchError } = await client
      .from('reports')
      .select('user_id')
      .eq('report_id', report_id)
      .single();

    if (fetchError || !existingReport) {
      throw new InternalServerErrorException('Failed to fetch existing report for update');
    }

    if (existingReport.user_id !== userId) {
      throw new UnauthorizedException('User does not have permission to update this report');
    }
  }

    let { data: cw_report_data, error: cw_report_error } = await client
  .from('reports')
  .update(reportData)
  .eq('report_id', report_id)
  .select('*')
  .single();
if (cw_report_error || !cw_report_data) {
  throw new InternalServerErrorException('Failed to update report');
}

for (const point of report_alert_points ?? []) {
  if (point.id) {
    const { error } = await client
      .from('report_alert_points')
      .update(point)
      .eq('report_id', report_id)
      .eq('id', point.id);

    if (error) {
      throw new InternalServerErrorException('Failed to update report alert points');
    }
  } else {
    const { error } = await client
      .from('report_alert_points')
      .insert({
        ...point,
        report_id: report_id,
        user_id: userId,
      });

    if (error) {
      throw new InternalServerErrorException('Failed to update report alert points');
    }
  }
}

let { data: scheduleData, error: scheduleError } = await client
  .from('report_user_schedule')
  .delete()
  .eq('report_id', report_id)
  .select('*');
if (scheduleError) {
  throw new InternalServerErrorException('Failed to update report user schedule');
}

let { data: recipientsData, error: recipientsError } = await client
  .from('report_recipients')
  .delete()
  .eq('report_id', report_id)
  .select('*');
if (recipientsError) {
  throw new InternalServerErrorException('Failed to update report recipients');
}


let { data, error } = await client
  .from('reports')
  .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
  .eq('report_id', report_id)
  .single();

if (error || !data) {
  throw new InternalServerErrorException('Failed to fetch updated report');
}

return data;
  }

  async remove(report_id: string, jwtPayload: any, authHeader: string) {
  const userId = getUserId(jwtPayload);
  const accessToken = getAccessToken(authHeader);
  const isGlobalUser = isCropwatchStaff(jwtPayload);

  const hasReportPermission: boolean = await this.hasPermissionToReport(userId, report_id, accessToken, isGlobalUser);
  if (!hasReportPermission) {
    throw new UnauthorizedException('User does not have permission to remove this report');
  }

  let query = this.supabaseService
    .getClient(accessToken)
    .from('reports')
    .delete()
    .eq('report_id', report_id) // MUST HAVE THIS!!!!!
    .select('*');

  if (!isGlobalUser) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.single();

  if (error) {
    throw new InternalServerErrorException('Failed to remove report');
  }

  return data;
}
  private async hasPermissionToReport(
  userId: string,
  reportId: string,
  accessToken: string,
  isGlobalUser: boolean,
): Promise < boolean > {
  let query = this.supabaseService
    .getClient(accessToken)
    .from('reports')
    .select('id')
    .eq('report_id', reportId);

  if(!isGlobalUser) {
    query = query.eq('user_id', userId);
  }

    const { data, error } = await query.single();

  if(error) {
    console.error('Error checking report permissions:', error);
    throw new InternalServerErrorException('Failed to check report permissions');
  }

    return !!data; // If data exists, the user has permission
}
}
