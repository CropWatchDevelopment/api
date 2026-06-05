import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
import type { TableRow } from '../types/supabase';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import { CommunicationMethodDto } from './dto/communication-method.dto';
import { ReportFormContextDto } from './dto/report-form-context.dto';
import { ReportTemplateAlertPointDto } from './dto/report-template-alert-point.dto';
import { ReportTemplateAssignmentDto } from './dto/report-template-assignment.dto';
import { ReportTemplateDataProcessingScheduleDto } from './dto/report-template-data-processing-schedule.dto';
import { ReportTemplateHistoryItemDto } from './dto/report-template-history-item.dto';
import { ReportTemplateRecipientDto } from './dto/report-template-recipient.dto';
import { ReportTemplateScheduleDto } from './dto/report-template-schedule.dto';
import { ReportTemplateDto } from './dto/report-template.dto';
import { SaveReportTemplateDto } from './dto/save-report-template.dto';

type TemplateRow = TableRow<'cw_report_templates'>;
type LocationJoin = { name: string | null };
type DeviceLocationJoin = { cw_locations?: LocationJoin | LocationJoin[] | null };
type AssignmentRow = TableRow<'cw_device_report_assignments'> & {
  cw_devices?: DeviceLocationJoin | DeviceLocationJoin[] | null;
};
type ScheduleRow = TableRow<'cw_report_template_schedule'>;
type RecipientRow = TableRow<'cw_report_template_recipients'>;
type AlertPointRow = TableRow<'cw_report_template_alert_points'>;
type DataProcessingScheduleRow =
  TableRow<'cw_report_template_data_processing_schedules'>;
type CommunicationMethodRow = TableRow<'communication_methods'>;
type DeviceRow = TableRow<'cw_devices'>;
type DeviceOwnerRow = TableRow<'cw_device_owners'>;

const STORAGE_BUCKET = 'Reports';

interface ManagedDevice {
  devEui: string;
  name: string | null;
  permissionLevel: number | null;
  canView: boolean;
  canManage: boolean;
}

interface NormalizedScheduleRow {
  endOfDay: boolean;
  endOfWeek: boolean;
  endOfMonth: boolean;
  utcOffset: number;
  isActive: boolean;
}

interface NormalizedRecipientRow {
  communicationMethod: number;
  email: string | null;
  name: string | null;
}

interface NormalizedAlertPointRow {
  name: string;
  dataPointKey: string;
  operator: string | null;
  min: number | null;
  max: number | null;
  value: number | null;
  hexColor: string | null;
}

interface NormalizedDataProcessingScheduleRow {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  ruleType: string;
  validFrom: string | null;
  validTo: string | null;
  timezone: string;
  isEnabled: boolean;
}

interface NormalizedSaveRequest {
  name: string;
  description: string | null;
  dataPullInterval: number;
  deviceTypeId: number | null;
  isActive: boolean;
  devEuis: string[];
  schedule: NormalizedScheduleRow[];
  recipients: NormalizedRecipientRow[];
  alertPoints: NormalizedAlertPointRow[];
  dataProcessingSchedules: NormalizedDataProcessingScheduleRow[];
}

@Injectable()
export class ReportsNewService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly devicesService: DevicesService,
    private readonly locationsService: LocationsService,
  ) {}

  async findAll(
    jwtPayload: any,
    authHeader: string,
    searchTerm?: string,
  ): Promise<ReportTemplateDto[]> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isStaff = isCropwatchStaff(jwtPayload);

    const devices = await this.listManagedDevices(userId, accessToken, isStaff);
    const viewableDevices = devices.filter((device) => device.canView);
    if (viewableDevices.length === 0) return [];

    const client = this.supabaseService.getClient(accessToken);
    const { data: assignmentsData, error: assignmentsError } = await client
      .from('cw_device_report_assignments')
      .select('created_at, dev_eui, id, is_active, template_id, cw_devices(cw_locations(name))')
      .in(
        'dev_eui',
        viewableDevices.map((device) => device.devEui),
      );

    if (assignmentsError) {
      throw new InternalServerErrorException('Failed to load report assignments');
    }

    const assignments = (assignmentsData ?? []) as AssignmentRow[];
    const templateIds = uniqueValues(assignments.map((row) => row.template_id));
    if (templateIds.length === 0) return [];

    const [templates, schedule, recipients, alertPoints, dpSchedules] =
      await Promise.all([
        this.loadTemplatesByIds(accessToken, templateIds),
        this.loadScheduleByTemplateIds(accessToken, templateIds),
        this.loadRecipientsByTemplateIds(accessToken, templateIds),
        this.loadAlertPointsByTemplateIds(accessToken, templateIds),
        this.loadDataProcessingSchedulesByTemplateIds(accessToken, templateIds),
      ]);

    const reports = buildReportTemplates({
      templates,
      assignments,
      schedule,
      recipients,
      alertPoints,
      dpSchedules,
      devices,
    });

    const search = searchTerm?.trim().toLowerCase();
    if (!search) return reports;
    return reports.filter((report) => matchesSearch(report, search));
  }

  async findOne(
    id: number,
    jwtPayload: any,
    authHeader: string,
  ): Promise<ReportTemplateDto> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isStaff = isCropwatchStaff(jwtPayload);

    const devices = await this.listManagedDevices(userId, accessToken, isStaff);
    const viewableDevices = devices.filter((device) => device.canView);
    if (viewableDevices.length === 0) {
      throw new NotFoundException('Report template not found');
    }

    const client = this.supabaseService.getClient(accessToken);
    const [templateResult, assignmentsResult] = await Promise.all([
      client
        .from('cw_report_templates')
        .select(
          'created_at, data_pull_interval, description, device_type_id, id, is_active, name',
        )
        .eq('id', id)
        .maybeSingle(),
      client
        .from('cw_device_report_assignments')
        .select('created_at, dev_eui, id, is_active, template_id, cw_devices(cw_locations(name))')
        .eq('template_id', id)
        .in(
          'dev_eui',
          viewableDevices.map((device) => device.devEui),
        ),
    ]);

    if (templateResult.error) {
      throw new InternalServerErrorException('Failed to load report template');
    }
    if (assignmentsResult.error) {
      throw new InternalServerErrorException('Failed to load report assignments');
    }
    if (!templateResult.data) {
      throw new NotFoundException('Report template not found');
    }

    const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
    if (assignments.length === 0) {
      throw new NotFoundException('Report template not found');
    }

    const [schedule, recipients, alertPoints, dpSchedules] = await Promise.all([
      this.loadScheduleByTemplateIds(accessToken, [id]),
      this.loadRecipientsByTemplateIds(accessToken, [id]),
      this.loadAlertPointsByTemplateIds(accessToken, [id]),
      this.loadDataProcessingSchedulesByTemplateIds(accessToken, [id]),
    ]);

    const [report] = buildReportTemplates({
      templates: [templateResult.data as TemplateRow],
      assignments,
      schedule,
      recipients,
      alertPoints,
      dpSchedules,
      devices,
    });

    if (!report) {
      throw new NotFoundException('Report template not found');
    }

    return report;
  }

  async create(
    payload: SaveReportTemplateDto,
    jwtPayload: any,
    authHeader: string,
  ): Promise<ReportTemplateDto> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isStaff = isCropwatchStaff(jwtPayload);

    const normalized = normalizeSaveRequest(payload);
    const devices = await this.listManagedDevices(userId, accessToken, isStaff);
    assertDevicesCanBeManaged(devices, normalized.devEuis);

    const client = this.supabaseService.getClient(accessToken);
    const { data: templateData, error: templateError } = await client
      .from('cw_report_templates')
      .insert({
        name: normalized.name,
        description: normalized.description,
        data_pull_interval: normalized.dataPullInterval,
        device_type_id: normalized.deviceTypeId,
        is_active: normalized.isActive,
        created_by: userId,
      })
      .select(
        'created_at, data_pull_interval, description, device_type_id, id, is_active, name',
      )
      .single();

    if (templateError || !templateData) {
      throw new InternalServerErrorException('Failed to create report template');
    }

    try {
      await this.replaceTemplateChildren(
        accessToken,
        templateData.id,
        normalized,
      );
    } catch (error) {
      await this.deleteTemplateBestEffort(accessToken, templateData.id);
      throw error;
    }

    return this.findOne(templateData.id, jwtPayload, authHeader);
  }

  async update(
    id: number,
    payload: SaveReportTemplateDto,
    jwtPayload: any,
    authHeader: string,
  ): Promise<ReportTemplateDto> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isStaff = isCropwatchStaff(jwtPayload);

    const normalized = normalizeSaveRequest(payload);
    const existing = await this.findOne(id, jwtPayload, authHeader);
    const devices = await this.listManagedDevices(userId, accessToken, isStaff);

    const allDevEuis = uniqueValues([
      ...existing.assignments.map((assignment) => assignment.devEui),
      ...normalized.devEuis,
    ]);
    assertDevicesCanBeManaged(devices, allDevEuis);

    const client = this.supabaseService.getClient(accessToken);
    const { error: updateError } = await client
      .from('cw_report_templates')
      .update({
        name: normalized.name,
        description: normalized.description,
        data_pull_interval: normalized.dataPullInterval,
        device_type_id: normalized.deviceTypeId,
        is_active: normalized.isActive,
      })
      .eq('id', id);

    if (updateError) {
      throw new InternalServerErrorException('Failed to update report template');
    }

    await this.replaceTemplateChildren(accessToken, id, normalized);

    return this.findOne(id, jwtPayload, authHeader);
  }

  async remove(
    id: number,
    jwtPayload: any,
    authHeader: string,
  ): Promise<{ id: number }> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isStaff = isCropwatchStaff(jwtPayload);

    const existing = await this.findOne(id, jwtPayload, authHeader);
    const devices = await this.listManagedDevices(userId, accessToken, isStaff);
    assertDevicesCanBeManaged(
      devices,
      existing.assignments.map((assignment) => assignment.devEui),
    );

    await this.deleteTemplateChildren(accessToken, id);

    const client = this.supabaseService.getClient(accessToken);
    const { error } = await client
      .from('cw_report_templates')
      .delete()
      .eq('id', id);

    if (error) {
      throw new InternalServerErrorException('Failed to delete report template');
    }

    return { id };
  }

  async getFormContext(
    jwtPayload: any,
    authHeader: string,
    templateId?: number,
  ): Promise<ReportFormContextDto> {
    const [devicesPage, locations, communicationMethods, template] =
      await Promise.all([
        this.devicesService.findAll(jwtPayload, authHeader),
        this.locationsService.findAll(jwtPayload, authHeader),
        this.findAllCommunicationMethods(authHeader),
        typeof templateId === 'number'
          ? this.findOne(templateId, jwtPayload, authHeader)
          : Promise.resolve(null),
      ]);

    return {
      devices: (devicesPage.data ?? []) as ReportFormContextDto['devices'],
      locations: (locations ?? []) as ReportFormContextDto['locations'],
      communicationMethods,
      template,
    };
  }

  async findAllCommunicationMethods(
    authHeader: string,
  ): Promise<CommunicationMethodDto[]> {
    const accessToken = getAccessToken(authHeader);
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('communication_methods')
      .select('communication_method_id, name, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load communication methods',
      );
    }

    return ((data ?? []) as CommunicationMethodRow[]).map((row) => ({
      communicationMethodId: row.communication_method_id,
      name: row.name ?? null,
      isActive: row.is_active ?? true,
    }));
  }

  async getHistory(
    id: number,
    jwtPayload: any,
    authHeader: string,
  ): Promise<ReportTemplateHistoryItemDto[]> {
    // Reuse findOne so a hidden or non-existent template returns 404 instead of
    // an empty list.
    const template = await this.findOne(id, jwtPayload, authHeader);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const devEuis = uniqueValues(
      template.assignments.map((assignment) => assignment.devEui),
    );
    const deviceNames = new Map(
      template.assignments.map((assignment) => [
        assignment.devEui,
        assignment.deviceName,
      ]),
    );

    const perDevice = await Promise.all(
      devEuis.map(async (devEui) => {
        const { data, error } = await client.storage
          .from(STORAGE_BUCKET)
          .list(devEui, {
            limit: 110,
            offset: 0,
            sortBy: { column: 'name', order: 'desc' },
          });
        if (error || !data) return [] as ReportTemplateHistoryItemDto[];
        return data
          .filter((item) => item.name && item.name !== '.emptyFolderPlaceholder')
          .map(
            (item): ReportTemplateHistoryItemDto => ({
              devEui,
              deviceName: deviceNames.get(devEui) ?? null,
              name: item.name,
              id: (item as { id?: string | null }).id ?? null,
              createdAt: (item as { created_at?: string | null }).created_at ?? null,
              updatedAt: (item as { updated_at?: string | null }).updated_at ?? null,
              lastAccessedAt:
                (item as { last_accessed_at?: string | null }).last_accessed_at ??
                null,
              metadata:
                (item as { metadata?: Record<string, unknown> | null }).metadata ??
                null,
            }),
          );
      }),
    );

    return perDevice.flat();
  }

  async getDownloadUrl(
    devEui: string,
    reportName: string,
    jwtPayload: any,
    authHeader: string,
  ): Promise<{ url: string }> {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isStaff = isCropwatchStaff(jwtPayload);

    const normalizedDevEui = devEui?.trim();
    const normalizedName = reportName?.trim();
    if (!normalizedDevEui || !normalizedName) {
      throw new BadRequestException('dev_eui and reportName are required');
    }
    const resolvedName = normalizedName.toLowerCase().endsWith('.pdf')
      ? normalizedName
      : `${normalizedName}.pdf`;

    const devices = await this.listManagedDevices(userId, accessToken, isStaff);
    const device = devices.find((entry) => entry.devEui === normalizedDevEui);
    if (!device || !device.canView) {
      throw new UnauthorizedException(
        'You do not have permission to download this report',
      );
    }

    const storageClient =
      this.supabaseService.getAdminClient() ??
      this.supabaseService.getClient(accessToken);
    const { data, error } = await storageClient.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(`${normalizedDevEui}/${resolvedName}`, 60, {
        download: true,
      });

    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException(
        'Failed to generate report download URL',
      );
    }

    return { url: data.signedUrl };
  }

  private async listManagedDevices(
    userId: string,
    accessToken: string,
    isStaff: boolean,
  ): Promise<ManagedDevice[]> {
    const client = this.supabaseService.getClient(accessToken);
    const { data, error } = await client
      .from('cw_devices')
      .select('dev_eui, name, user_id, cw_device_owners(*)');

    if (error) {
      throw new InternalServerErrorException('Failed to load devices');
    }

    const rows = (data ?? []) as Array<
      Pick<DeviceRow, 'dev_eui' | 'name' | 'user_id'> & {
        cw_device_owners?: DeviceOwnerRow[] | null;
      }
    >;

    return rows
      .map((row): ManagedDevice => {
        const owners = Array.isArray(row.cw_device_owners)
          ? row.cw_device_owners
          : [];
        const ownEntry = owners.find((entry) => entry.user_id === userId);
        const directOwner = row.user_id === userId;
        const permissionLevel = directOwner
          ? 1
          : (ownEntry?.permission_level ?? null);
        const canView =
          isStaff || directOwner || (permissionLevel != null && permissionLevel <= 3);
        const canManage =
          isStaff || directOwner || (permissionLevel != null && permissionLevel <= 2);

        return {
          devEui: row.dev_eui,
          name: row.name?.trim() ? row.name : null,
          permissionLevel,
          canView,
          canManage,
        };
      })
      .filter((device) => device.devEui.length > 0);
  }

  private async loadTemplatesByIds(
    accessToken: string,
    templateIds: number[],
  ): Promise<TemplateRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_report_templates')
      .select(
        'created_at, data_pull_interval, description, device_type_id, id, is_active, name',
      )
      .in('id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load report templates');
    }

    return (data ?? []) as TemplateRow[];
  }

  private async loadScheduleByTemplateIds(
    accessToken: string,
    templateIds: number[],
  ): Promise<ScheduleRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_report_template_schedule')
      .select(
        'created_at, end_of_day, end_of_month, end_of_week, id, is_active, template_id, utc_offset',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load report schedule');
    }

    return (data ?? []) as ScheduleRow[];
  }

  private async loadRecipientsByTemplateIds(
    accessToken: string,
    templateIds: number[],
  ): Promise<RecipientRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_report_template_recipients')
      .select(
        'communication_method, created_at, email, id, name, template_id',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load report recipients');
    }

    return (data ?? []) as RecipientRow[];
  }

  private async loadAlertPointsByTemplateIds(
    accessToken: string,
    templateIds: number[],
  ): Promise<AlertPointRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_report_template_alert_points')
      .select(
        'created_at, data_point_key, hex_color, id, max, min, name, operator, template_id, value',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load report alert points');
    }

    return (data ?? []) as AlertPointRow[];
  }

  private async loadDataProcessingSchedulesByTemplateIds(
    accessToken: string,
    templateIds: number[],
  ): Promise<DataProcessingScheduleRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_report_template_data_processing_schedules')
      .select(
        'created_at, crosses_midnight, day_of_week, end_time, id, is_enabled, rule_type, start_time, template_id, timezone, updated_at, valid_from, valid_to',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load report data processing schedules',
      );
    }

    return (data ?? []) as DataProcessingScheduleRow[];
  }

  private async replaceTemplateChildren(
    accessToken: string,
    templateId: number,
    payload: NormalizedSaveRequest,
  ): Promise<void> {
    await this.deleteTemplateChildren(accessToken, templateId);

    const client = this.supabaseService.getClient(accessToken);

    const assignments = payload.devEuis.map((devEui) => ({
      dev_eui: devEui,
      template_id: templateId,
      is_active: true,
    }));
    const { error: assignmentsError } = await client
      .from('cw_device_report_assignments')
      .insert(assignments);
    if (assignmentsError) {
      throw new InternalServerErrorException('Failed to save report assignments');
    }

    if (payload.schedule.length > 0) {
      const rows = payload.schedule.map((entry) => ({
        template_id: templateId,
        end_of_day: entry.endOfDay,
        end_of_week: entry.endOfWeek,
        end_of_month: entry.endOfMonth,
        utc_offset: entry.utcOffset,
        is_active: entry.isActive,
      }));
      const { error } = await client
        .from('cw_report_template_schedule')
        .insert(rows);
      if (error) {
        throw new InternalServerErrorException('Failed to save report schedule');
      }
    }

    if (payload.recipients.length > 0) {
      const rows = payload.recipients.map((entry) => ({
        template_id: templateId,
        communication_method: entry.communicationMethod,
        email: entry.email,
        name: entry.name,
      }));
      const { error } = await client
        .from('cw_report_template_recipients')
        .insert(rows);
      if (error) {
        throw new InternalServerErrorException('Failed to save report recipients');
      }
    }

    if (payload.alertPoints.length > 0) {
      const rows = payload.alertPoints.map((entry) => ({
        template_id: templateId,
        name: entry.name,
        data_point_key: entry.dataPointKey,
        operator: entry.operator,
        min: entry.min,
        max: entry.max,
        value: entry.value,
        hex_color: entry.hexColor,
      }));
      const { error } = await client
        .from('cw_report_template_alert_points')
        .insert(rows);
      if (error) {
        throw new InternalServerErrorException(
          'Failed to save report alert points',
        );
      }
    }

    if (payload.dataProcessingSchedules.length > 0) {
      const rows = payload.dataProcessingSchedules.map((entry) => ({
        template_id: templateId,
        day_of_week: entry.dayOfWeek,
        start_time: entry.startTime,
        end_time: entry.endTime,
        crosses_midnight: entry.crossesMidnight,
        rule_type: entry.ruleType,
        valid_from: entry.validFrom,
        valid_to: entry.validTo,
        timezone: entry.timezone,
        is_enabled: entry.isEnabled,
      }));
      const { error } = await client
        .from('cw_report_template_data_processing_schedules')
        .insert(rows);
      if (error) {
        throw new InternalServerErrorException(
          'Failed to save report data processing schedules',
        );
      }
    }
  }

  private async deleteTemplateChildren(
    accessToken: string,
    templateId: number,
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);
    const [assignments, schedule, recipients, alertPoints, dpSchedules] =
      await Promise.all([
        client
          .from('cw_device_report_assignments')
          .delete()
          .eq('template_id', templateId),
        client
          .from('cw_report_template_schedule')
          .delete()
          .eq('template_id', templateId),
        client
          .from('cw_report_template_recipients')
          .delete()
          .eq('template_id', templateId),
        client
          .from('cw_report_template_alert_points')
          .delete()
          .eq('template_id', templateId),
        client
          .from('cw_report_template_data_processing_schedules')
          .delete()
          .eq('template_id', templateId),
      ]);

    if (assignments.error) {
      throw new InternalServerErrorException('Failed to remove report assignments');
    }
    if (schedule.error) {
      throw new InternalServerErrorException('Failed to remove report schedule');
    }
    if (recipients.error) {
      throw new InternalServerErrorException('Failed to remove report recipients');
    }
    if (alertPoints.error) {
      throw new InternalServerErrorException(
        'Failed to remove report alert points',
      );
    }
    if (dpSchedules.error) {
      throw new InternalServerErrorException(
        'Failed to remove report data processing schedules',
      );
    }
  }

  private async deleteTemplateBestEffort(
    accessToken: string,
    templateId: number,
  ): Promise<void> {
    try {
      await this.deleteTemplateChildren(accessToken, templateId);
      await this.supabaseService
        .getClient(accessToken)
        .from('cw_report_templates')
        .delete()
        .eq('id', templateId);
    } catch {
      // The template was created but children/template cleanup failed; leaving
      // the orphan is preferable to surfacing the cleanup error to the caller.
    }
  }
}

function extractLocationName(assignment: AssignmentRow): string | null {
  const device = Array.isArray(assignment.cw_devices)
    ? assignment.cw_devices[0]
    : assignment.cw_devices;
  if (!device) return null;
  const location = Array.isArray(device.cw_locations)
    ? device.cw_locations[0]
    : device.cw_locations;
  const name = location?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name : null;
}

function buildReportTemplates(args: {
  templates: TemplateRow[];
  assignments: AssignmentRow[];
  schedule: ScheduleRow[];
  recipients: RecipientRow[];
  alertPoints: AlertPointRow[];
  dpSchedules: DataProcessingScheduleRow[];
  devices: ManagedDevice[];
}): ReportTemplateDto[] {
  const { templates, assignments, schedule, recipients, alertPoints, dpSchedules, devices } =
    args;

  const devicesById = new Map(devices.map((device) => [device.devEui, device]));
  const assignmentsByTemplateId = groupBy(
    assignments,
    (assignment) => assignment.template_id,
  );
  const scheduleByTemplateId = groupBy(schedule, (row) => row.template_id);
  const recipientsByTemplateId = groupBy(recipients, (row) => row.template_id);
  const alertPointsByTemplateId = groupBy(alertPoints, (row) => row.template_id);
  const dpSchedulesByTemplateId = groupBy(dpSchedules, (row) => row.template_id);

  return templates
    .map((template): ReportTemplateDto | null => {
      const templateAssignments = assignmentsByTemplateId.get(template.id) ?? [];
      if (templateAssignments.length === 0) return null;

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        deviceTypeId: template.device_type_id,
        dataPullInterval: template.data_pull_interval,
        isActive: template.is_active ?? true,
        createdAt: template.created_at,
        assignments: templateAssignments.map(
          (assignment): ReportTemplateAssignmentDto => {
            const device = devicesById.get(assignment.dev_eui);
            return {
              id: assignment.id,
              devEui: assignment.dev_eui,
              templateId: assignment.template_id,
              isActive: assignment.is_active ?? true,
              createdAt: assignment.created_at,
              deviceName: device?.name ?? null,
              locationName: extractLocationName(assignment),
              permissionLevel: device?.permissionLevel ?? null,
            };
          },
        ),
        schedule: (scheduleByTemplateId.get(template.id) ?? []).map(mapSchedule),
        recipients: (recipientsByTemplateId.get(template.id) ?? []).map(
          mapRecipient,
        ),
        alertPoints: (alertPointsByTemplateId.get(template.id) ?? []).map(
          mapAlertPoint,
        ),
        dataProcessingSchedules: (dpSchedulesByTemplateId.get(template.id) ?? []).map(
          mapDataProcessingSchedule,
        ),
      };
    })
    .filter((report): report is ReportTemplateDto => report !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapSchedule(row: ScheduleRow): ReportTemplateScheduleDto {
  return {
    id: row.id,
    templateId: row.template_id,
    endOfDay: row.end_of_day ?? false,
    endOfWeek: row.end_of_week ?? false,
    endOfMonth: row.end_of_month ?? false,
    utcOffset: row.utc_offset ?? 9,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
  };
}

function mapRecipient(row: RecipientRow): ReportTemplateRecipientDto {
  return {
    id: row.id,
    templateId: row.template_id,
    communicationMethod: row.communication_method,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  };
}

function mapAlertPoint(row: AlertPointRow): ReportTemplateAlertPointDto {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    dataPointKey: row.data_point_key,
    operator: row.operator,
    min: row.min,
    max: row.max,
    value: row.value,
    hexColor: row.hex_color,
    createdAt: row.created_at,
  };
}

function mapDataProcessingSchedule(
  row: DataProcessingScheduleRow,
): ReportTemplateDataProcessingScheduleDto {
  return {
    id: row.id,
    templateId: row.template_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    crossesMidnight: row.crosses_midnight ?? false,
    ruleType: row.rule_type ?? 'include',
    validFrom: row.valid_from,
    validTo: row.valid_to,
    timezone: row.timezone ?? 'Asia/Tokyo',
    isEnabled: row.is_enabled ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSaveRequest(
  payload: SaveReportTemplateDto,
): NormalizedSaveRequest {
  const name = (payload.name ?? '').trim();
  if (!name) {
    throw new BadRequestException('Report name is required');
  }

  const devEuis = uniqueValues(
    (payload.devEuis ?? [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0),
  );
  if (devEuis.length === 0) {
    throw new BadRequestException('At least one device is required');
  }

  const schedule = (payload.schedule ?? []).map(
    (entry): NormalizedScheduleRow => ({
      endOfDay: entry.endOfDay ?? false,
      endOfWeek: entry.endOfWeek ?? false,
      endOfMonth: entry.endOfMonth ?? false,
      utcOffset:
        typeof entry.utcOffset === 'number' && Number.isFinite(entry.utcOffset)
          ? entry.utcOffset
          : 9,
      isActive: entry.isActive ?? true,
    }),
  );

  const recipients = (payload.recipients ?? []).map(
    (entry, index): NormalizedRecipientRow => {
      if (!Number.isInteger(entry.communicationMethod)) {
        throw new BadRequestException(
          `Recipient ${index + 1} needs a communication method`,
        );
      }
      return {
        communicationMethod: entry.communicationMethod,
        email: trimOrNull(entry.email),
        name: trimOrNull(entry.name),
      };
    },
  );

  const alertPoints = (payload.alertPoints ?? []).map(
    (entry, index): NormalizedAlertPointRow => {
      const apName = (entry.name ?? '').trim();
      const dataPointKey = (entry.dataPointKey ?? '').trim();
      if (!apName || !dataPointKey) {
        throw new BadRequestException(
          `Alert point ${index + 1} must include a name and a data point`,
        );
      }
      return {
        name: apName,
        dataPointKey,
        operator: trimOrNull(entry.operator),
        min: numberOrNull(entry.min),
        max: numberOrNull(entry.max),
        value: numberOrNull(entry.value),
        hexColor: trimOrNull(entry.hexColor),
      };
    },
  );

  const dataProcessingSchedules = (payload.dataProcessingSchedules ?? []).map(
    (entry, index): NormalizedDataProcessingScheduleRow => {
      const startTime = (entry.startTime ?? '').trim();
      const endTime = (entry.endTime ?? '').trim();
      if (!Number.isInteger(entry.dayOfWeek) || !startTime || !endTime) {
        throw new BadRequestException(
          `Processing window ${index + 1} must include a day, start time, and end time`,
        );
      }
      return {
        dayOfWeek: entry.dayOfWeek,
        startTime,
        endTime,
        crossesMidnight: entry.crossesMidnight ?? false,
        ruleType:
          typeof entry.ruleType === 'string' && entry.ruleType.trim()
            ? entry.ruleType.trim()
            : 'include',
        validFrom: trimOrNull(entry.validFrom),
        validTo: trimOrNull(entry.validTo),
        timezone:
          typeof entry.timezone === 'string' && entry.timezone.trim()
            ? entry.timezone.trim()
            : 'Asia/Tokyo',
        isEnabled: entry.isEnabled ?? true,
      };
    },
  );

  return {
    name,
    description:
      typeof payload.description === 'string' && payload.description.trim()
        ? payload.description.trim()
        : null,
    dataPullInterval:
      typeof payload.dataPullInterval === 'number' &&
      Number.isFinite(payload.dataPullInterval) &&
      payload.dataPullInterval > 0
        ? Math.floor(payload.dataPullInterval)
        : 30,
    deviceTypeId:
      typeof payload.deviceTypeId === 'number' &&
      Number.isFinite(payload.deviceTypeId)
        ? payload.deviceTypeId
        : null,
    isActive: typeof payload.isActive === 'boolean' ? payload.isActive : true,
    devEuis,
    schedule,
    recipients,
    alertPoints,
    dataProcessingSchedules,
  };
}

function assertDevicesCanBeManaged(
  devices: ManagedDevice[],
  devEuis: string[],
): void {
  const manageable = new Set(
    devices.filter((device) => device.canManage).map((device) => device.devEui),
  );
  const missing = devEuis.find((devEui) => !manageable.has(devEui));
  if (missing) {
    throw new ForbiddenException(
      'You do not have permission to manage one or more selected devices',
    );
  }
}

function matchesSearch(report: ReportTemplateDto, search: string): boolean {
  const deviceText = report.assignments
    .map((assignment) => `${assignment.deviceName ?? ''} ${assignment.devEui}`)
    .join(' ');
  return [report.name, report.description ?? '', deviceText]
    .join(' ')
    .toLowerCase()
    .includes(search);
}

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function groupBy<T, TKey>(items: T[], key: (item: T) => TKey): Map<TKey, T[]> {
  const result = new Map<TKey, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const existing = result.get(groupKey);
    if (existing) {
      existing.push(item);
    } else {
      result.set(groupKey, [item]);
    }
  }
  return result;
}

function uniqueValues<T extends string | number>(values: T[]): T[] {
  return [...new Set(values)];
}
