import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { SupabaseService } from 'src/supabase/supabase.service';
import { ReportDto } from './dto/report.dto';

@Injectable()
export class ReportsService {

  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  async create(createReportDto: CreateReportDto, jwtPayload: any, authHeader: string): Promise<ReportDto> {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    delete createReportDto.id; // Ensure ID is not set by client
    delete createReportDto.created_at; // Ensure created_at is not set by client
    delete createReportDto.report_id; // Ensure report_id is not set by client
    createReportDto.report_alert_points?.map(point => delete point.id); // Ensure alert point IDs are not set by client
    createReportDto.report_user_schedule?.map(schedule => delete schedule.id); // Ensure user schedule IDs are not set by client
    createReportDto.report_recipients?.map(recipient => delete recipient.id); // Ensure recipient IDs are not set by client
    createReportDto.user_id = userId; // Ensure the report is associated with the authenticated user

    // Split each dto into seperate objects by table:
    const { report_user_schedule, report_alert_points, report_recipients, ...reportData } = createReportDto;

    const { data, error } = await client
      .from('reports')
      .insert(reportData)
      .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to create report');
    }

    return data;
  }

  async findAll(jwtPayload: any, authHeader: string): Promise<ReportDto[]> {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('reports')
      .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
      .order('name', { ascending: true })
      .eq('user_id', userId);
    if (error) {
      throw new InternalServerErrorException('Failed to fetch reports');
    }

    return data;
  }

  async findOne(report_id: string, jwtPayload: any, authHeader: string): Promise<ReportDto> {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('reports')
      .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
      .order('name', { ascending: true })
      .eq('user_id', userId)
      .eq('report_id', report_id)
      .single();
    if (error) {
      throw new InternalServerErrorException('Failed to fetch report');
    }

    return data;
  }

  async update(report_id: string, updateReportDto: UpdateReportDto, jwtPayload: any, authHeader: string): Promise<ReportDto> {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const hasPermission = await this.hasPermissionToReport(userId, report_id, accessToken);
    if (!hasPermission) {
      throw new UnauthorizedException('User does not have permission to update this report');
    }

    // Strip fields the client should not control
    delete updateReportDto.id;
    delete updateReportDto.created_at;
    delete updateReportDto.report_id;

    // Separate child relations from core report data
    const { report_user_schedule, report_alert_points, report_recipients, ...reportData } = updateReportDto;

    const { data, error } = await client
      .from('reports')
      .update(reportData)
      .eq('report_id', report_id)
      .eq('user_id', userId)
      .select('*, report_recipients(*), report_user_schedule(*), report_alert_points(*)')
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to update report');
    }

    return data;
  }

  async remove(report_id: string, jwtPayload: any, authHeader: string) {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);

    const hasReportPermission: boolean = await this.hasPermissionToReport(userId, report_id, accessToken);
    if (!hasReportPermission) {
      throw new UnauthorizedException('User does not have permission to remove this report');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_reports')
      .delete()
      .eq('user_id', userId)
      .eq('report_id', report_id) // MUST HAVE THIS!!!!!
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to remove report');
    }

    return data;
  }



  /*********************************************************************
   * 
   * Private functions to handle common tasks such as extracting user ID from JWT payload,
   * 
   ********************************************************************/

  private getUserId(jwtPayload: any): string {
    const userId = jwtPayload?.sub;
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return userId;
  }

  private getAccessToken(authHeader: string): string {
    const rawHeader = authHeader?.trim() ?? '';
    const [scheme, token] = rawHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    return token;
  }

  private async hasPermissionToReport(userId: string, reportId: string, accessToken: string): Promise<boolean> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('reports')
      .select('id')
      .eq('report_id', reportId)
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Error checking report permissions:', error);
      throw new InternalServerErrorException('Failed to check report permissions');
    }

    return !!data; // If data exists, the user has permission
  }
}
