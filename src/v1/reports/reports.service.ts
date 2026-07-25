import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import {
  listManagedDevices,
  type ManagedDevice,
} from '../common/managed-devices.helper';
import {
  groupBy,
  matchesSearch,
  uniqueValues,
} from '../common/collection.helpers';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import { CommunicationMethodDto } from './dto/communication-method.dto';
import { ReportFormContextDto } from './dto/report-form-context.dto';
import { ReportTemplateAlertPointDto } from './dto/report-template-alert-point.dto';
import { ReportTemplateAssignmentDto } from './dto/report-template-assignment.dto';
import { ReportTemplateDataProcessingScheduleDto } from './dto/report-template-data-processing-schedule.dto';
import { ReportTemplateHistoryItemDto } from './dto/report-template-history-item.dto';
import { ReportRegenerationItemDto } from './dto/report-regeneration-item.dto';
import { RequestReportRegenerationDto } from './dto/request-report-regeneration.dto';
import { ReportTemplateRecipientDto } from './dto/report-template-recipient.dto';
import { ReportTemplateScheduleDto } from './dto/report-template-schedule.dto';
import { ReportTemplateDto } from './dto/report-template.dto';
import { SaveReportTemplateDto } from './dto/save-report-template.dto';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type TemplateRow = TableRow<'cw_report_templates'>;
type LocationJoin = { name: string | null };
type DeviceLocationJoin = {
  cw_locations?: LocationJoin | LocationJoin[] | null;
};
type AssignmentRow = TableRow<'cw_device_report_assignments'> & {
  cw_devices?: DeviceLocationJoin | DeviceLocationJoin[] | null;
};
type ScheduleRow = TableRow<'cw_report_template_schedule'>;
type RecipientRow = TableRow<'cw_report_template_recipients'>;
type AlertPointRow = TableRow<'cw_report_template_alert_points'>;
type DataProcessingScheduleRow =
  TableRow<'cw_report_template_data_processing_schedules'>;
type CommunicationMethodRow = TableRow<'communication_methods'>;

const STORAGE_BUCKET = 'Reports';

// Storage object names/dev_euis are interpolated into service-role storage
// paths (which bypass RLS) and echoed to the report generator — reject path
// separators / traversal wherever either is accepted from a client.
const UNSAFE_PATH_SEGMENT = /[\\/]|\.\./;

// Sensor data is retained for 24 months and a queued regeneration can wait up
// to a month for the next scheduled cron run — so note edits (and therefore
// regeneration requests) are only allowed while the report period ends within
// the last 23 months. The frontend enforces the same cutoff in the history
// dialog and the edit page; CW-Reports re-checks defensively when consuming.
const REPORT_EDIT_RETENTION_MONTHS = 23;

// Guard against nonsense period ranges: the longest real report window is one
// month; anything beyond ~2 months is a malformed request.
const MAX_REGENERATION_PERIOD_DAYS = 62;

interface RegenerationQueueRow {
  id: number;
  template_id: number;
  dev_eui: string;
  period_start: string;
  period_end: string;
  timezone: string;
  source_object_name: string;
  status: string;
  requested_by: string;
  requested_at: string;
  edit_count: number;
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
export class ReportsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly devicesService: DevicesService,
    private readonly locationsService: LocationsService,
  ) {}

  async findAll(
    user: AuthenticatedUser,
    searchTerm?: string,
  ): Promise<ReportTemplateDto[]> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
    const viewableDevices = devices.filter((device) => device.canView);
    if (viewableDevices.length === 0) return [];

    const client = this.supabaseService.getClient();
    const { data: assignmentsData, error: assignmentsError } = await client
      .from('cw_device_report_assignments')
      .select(
        'created_at, dev_eui, id, is_active, template_id, cw_devices(cw_locations(name))',
      )
      .in(
        'dev_eui',
        viewableDevices.map((device) => device.devEui),
      );

    if (assignmentsError) {
      throw new InternalServerErrorException(
        'Failed to load report assignments',
      );
    }

    const assignments = (assignmentsData ?? []) as AssignmentRow[];
    const templateIds = uniqueValues(assignments.map((row) => row.template_id));
    if (templateIds.length === 0) return [];

    const [templates, schedule, recipients, alertPoints, dpSchedules] =
      await Promise.all([
        this.loadTemplatesByIds(templateIds),
        this.loadScheduleByTemplateIds(templateIds),
        this.loadRecipientsByTemplateIds(templateIds),
        this.loadAlertPointsByTemplateIds(templateIds),
        this.loadDataProcessingSchedulesByTemplateIds(templateIds),
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
    user: AuthenticatedUser,
  ): Promise<ReportTemplateDto> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
    const viewableDevices = devices.filter((device) => device.canView);
    if (viewableDevices.length === 0) {
      throw new NotFoundException('Report template not found');
    }

    const client = this.supabaseService.getClient();
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
        .select(
          'created_at, dev_eui, id, is_active, template_id, cw_devices(cw_locations(name))',
        )
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
      throw new InternalServerErrorException(
        'Failed to load report assignments',
      );
    }
    if (!templateResult.data) {
      throw new NotFoundException('Report template not found');
    }

    const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
    if (assignments.length === 0) {
      throw new NotFoundException('Report template not found');
    }

    const [schedule, recipients, alertPoints, dpSchedules] = await Promise.all([
      this.loadScheduleByTemplateIds([id]),
      this.loadRecipientsByTemplateIds([id]),
      this.loadAlertPointsByTemplateIds([id]),
      this.loadDataProcessingSchedulesByTemplateIds([id]),
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
    user: AuthenticatedUser,
  ): Promise<ReportTemplateDto> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    const normalized = normalizeSaveRequest(payload);
    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
    assertDevicesCanBeManaged(devices, normalized.devEuis);

    const client = this.supabaseService.getClient();
    const { data: templateData, error: templateError } = (await client
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
      .single()) as {
      data: Pick<
        TemplateRow,
        | 'created_at'
        | 'data_pull_interval'
        | 'description'
        | 'device_type_id'
        | 'id'
        | 'is_active'
        | 'name'
      > | null;
      error: PostgrestError | null;
    };

    if (templateError || !templateData) {
      throw new InternalServerErrorException(
        'Failed to create report template',
      );
    }

    try {
      await this.replaceTemplateChildren(templateData.id, normalized);
    } catch (error) {
      await this.deleteTemplateBestEffort(templateData.id);
      throw error;
    }

    return this.findOne(templateData.id, user);
  }

  async update(
    id: number,
    payload: SaveReportTemplateDto,
    user: AuthenticatedUser,
  ): Promise<ReportTemplateDto> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    const normalized = normalizeSaveRequest(payload);
    const existing = await this.findOne(id, user);
    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );

    const allDevEuis = uniqueValues([
      ...existing.assignments.map((assignment) => assignment.devEui),
      ...normalized.devEuis,
    ]);
    assertDevicesCanBeManaged(devices, allDevEuis);

    const client = this.supabaseService.getClient();
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
      throw new InternalServerErrorException(
        'Failed to update report template',
      );
    }

    await this.replaceTemplateChildren(id, normalized);

    return this.findOne(id, user);
  }

  async remove(id: number, user: AuthenticatedUser): Promise<{ id: number }> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    const existing = await this.findOne(id, user);
    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
    assertDevicesCanBeManaged(
      devices,
      existing.assignments.map((assignment) => assignment.devEui),
    );

    await this.deleteTemplateChildren(id);

    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('cw_report_templates')
      .delete()
      .eq('id', id);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to delete report template',
      );
    }

    return { id };
  }

  async getFormContext(
    user: AuthenticatedUser,
    templateId?: number,
  ): Promise<ReportFormContextDto> {
    const [devicesPage, locations, communicationMethods, template] =
      await Promise.all([
        this.devicesService.findAll(user),
        this.locationsService.findAll(user),
        this.findAllCommunicationMethods(),
        typeof templateId === 'number'
          ? this.findOne(templateId, user)
          : Promise.resolve(null),
      ]);

    return {
      devices: devicesPage.data ?? [],
      locations: locations ?? [],
      communicationMethods,
      template,
    };
  }

  async findAllCommunicationMethods(): Promise<CommunicationMethodDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
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
    user: AuthenticatedUser,
  ): Promise<ReportTemplateHistoryItemDto[]> {
    // Reuse findOne so a hidden or non-existent template returns 404 instead of
    // an empty list.
    const template = await this.findOne(id, user);
    const client = this.supabaseService.getClient();

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
          .filter(
            (item) => item.name && item.name !== '.emptyFolderPlaceholder',
          )
          .map(
            (item): ReportTemplateHistoryItemDto => ({
              devEui,
              deviceName: deviceNames.get(devEui) ?? null,
              name: item.name,
              id: (item as { id?: string | null }).id ?? null,
              createdAt:
                (item as { created_at?: string | null }).created_at ?? null,
              updatedAt:
                (item as { updated_at?: string | null }).updated_at ?? null,
              lastAccessedAt:
                (item as { last_accessed_at?: string | null })
                  .last_accessed_at ?? null,
              metadata:
                (item as { metadata?: Record<string, unknown> | null })
                  .metadata ?? null,
            }),
          );
      }),
    );

    return perDevice.flat();
  }

  async getDownloadUrl(
    devEui: string,
    reportName: string,
    user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    const normalizedDevEui = devEui?.trim();
    const normalizedName = reportName?.trim();
    if (!normalizedDevEui || !normalizedName) {
      throw new BadRequestException('dev_eui and reportName are required');
    }
    // Both values are interpolated into the storage object path
    // (`${devEui}/${reportName}`) and signed with the service-role client, which
    // bypasses storage RLS — see UNSAFE_PATH_SEGMENT above.
    if (
      UNSAFE_PATH_SEGMENT.test(normalizedDevEui) ||
      UNSAFE_PATH_SEGMENT.test(normalizedName)
    ) {
      throw new BadRequestException('Invalid dev_eui or reportName');
    }
    const resolvedName = normalizedName.toLowerCase().endsWith('.pdf')
      ? normalizedName
      : `${normalizedName}.pdf`;

    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
    const device = devices.find((entry) => entry.devEui === normalizedDevEui);
    if (!device || !device.canView) {
      throw new UnauthorizedException(
        'You do not have permission to download this report',
      );
    }

    const storageClient =
      this.supabaseService.getAdminClient() ?? this.supabaseService.getClient();
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

  async requestRegeneration(
    id: number,
    dto: RequestReportRegenerationDto,
    user: AuthenticatedUser,
  ): Promise<ReportRegenerationItemDto> {
    // 404-gates the template exactly like getHistory: a template the user
    // cannot view does not exist as far as they are concerned.
    const template = await this.findOne(id, user);

    const normalizedDevEui = dto.devEui?.trim();
    if (!normalizedDevEui || UNSAFE_PATH_SEGMENT.test(normalizedDevEui)) {
      throw new BadRequestException('Invalid devEui');
    }
    const isAssigned = template.assignments.some(
      (assignment) => assignment.devEui === normalizedDevEui,
    );
    if (!isAssigned) {
      throw new BadRequestException(
        'Device is not assigned to this report template',
      );
    }

    // Regenerating a customer-facing PDF is a manage action (same tier as
    // template create/update/remove), not a view action.
    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      user.sub,
      user.isStaff,
    );
    assertDevicesCanBeManaged(devices, [normalizedDevEui]);

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (
      Number.isNaN(periodStart.getTime()) ||
      Number.isNaN(periodEnd.getTime()) ||
      periodEnd <= periodStart
    ) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }
    const periodDays =
      (periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000);
    if (periodDays > MAX_REGENERATION_PERIOD_DAYS) {
      throw new BadRequestException(
        `Report period cannot exceed ${MAX_REGENERATION_PERIOD_DAYS} days`,
      );
    }
    const retentionCutoff = new Date();
    retentionCutoff.setMonth(
      retentionCutoff.getMonth() - REPORT_EDIT_RETENTION_MONTHS,
    );
    if (periodEnd < retentionCutoff) {
      throw new BadRequestException(
        `Reports older than ${REPORT_EDIT_RETENTION_MONTHS} months can no longer be regenerated (sensor data is retained for 24 months)`,
      );
    }

    const normalizedObjectName = dto.sourceObjectName?.trim();
    if (
      !normalizedObjectName ||
      UNSAFE_PATH_SEGMENT.test(normalizedObjectName)
    ) {
      throw new BadRequestException('Invalid sourceObjectName');
    }

    const timezone = dto.timezone?.trim() || 'Asia/Tokyo';
    const requestedBy = user.email?.trim() || user.sub;
    const editCount = dto.editCount ?? 1;
    const client = this.supabaseService.getClient();
    const matchKeys = {
      dev_eui: normalizedDevEui,
      period_end: periodEnd.toISOString(),
      period_start: periodStart.toISOString(),
      template_id: id,
    };

    // Dedupe: at most one pending row per (template, device, period) — enforced
    // by a partial unique index. PostgREST upserts can't target a partial
    // index, so select-then-insert and treat the 23505 race as success.
    const existing = await this.findPendingRegeneration(client, matchKeys);
    if (existing) {
      const { data: touched, error: touchError } = (await client
        .from('cw_report_regeneration_queue')
        .update({
          requested_at: new Date().toISOString(),
          requested_by: requestedBy,
          edit_count: (existing.edit_count ?? 1) + editCount,
        })
        .eq('id', existing.id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()) as {
        data: RegenerationQueueRow | null;
        error: PostgrestError | null;
      };
      if (touchError) {
        throw new InternalServerErrorException(
          'Failed to update regeneration request',
        );
      }
      // Row may have been claimed between select and update — fall through to
      // insert a fresh pending row in that case.
      if (touched) {
        return toRegenerationItemDto(touched);
      }
    }

    const { data: inserted, error: insertError } = (await client
      .from('cw_report_regeneration_queue')
      .insert({
        ...matchKeys,
        requested_by: requestedBy,
        source_object_name: normalizedObjectName,
        timezone,
        edit_count: editCount,
      })
      .select('*')
      .single()) as {
      data: RegenerationQueueRow | null;
      error: PostgrestError | null;
    };

    if (insertError) {
      if (insertError.code === '23505') {
        // Concurrent request won the insert race; the pending row it created
        // covers this request too.
        const winner = await this.findPendingRegeneration(client, matchKeys);
        if (winner) {
          return toRegenerationItemDto(winner);
        }
      }
      throw new InternalServerErrorException(
        'Failed to queue report regeneration',
      );
    }
    if (!inserted) {
      throw new InternalServerErrorException(
        'Failed to queue report regeneration',
      );
    }

    return toRegenerationItemDto(inserted);
  }

  async getRegenerations(
    id: number,
    user: AuthenticatedUser,
  ): Promise<ReportRegenerationItemDto[]> {
    // Same 404 gate as getHistory: an invisible template has no queue either.
    await this.findOne(id, user);

    const { data, error } = (await this.supabaseService
      .getClient()
      .from('cw_report_regeneration_queue')
      .select('*')
      .eq('template_id', id)
      .in('status', ['pending', 'processing'])
      .order('requested_at', { ascending: false })) as {
      data: RegenerationQueueRow[] | null;
      error: PostgrestError | null;
    };

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load regeneration queue',
      );
    }

    return (data ?? []).map(toRegenerationItemDto);
  }

  private async findPendingRegeneration(
    client: ReturnType<SupabaseService['getClient']>,
    matchKeys: {
      dev_eui: string;
      period_end: string;
      period_start: string;
      template_id: number;
    },
  ): Promise<RegenerationQueueRow | null> {
    const { data, error } = (await client
      .from('cw_report_regeneration_queue')
      .select('*')
      .eq('template_id', matchKeys.template_id)
      .eq('dev_eui', matchKeys.dev_eui)
      .eq('period_start', matchKeys.period_start)
      .eq('period_end', matchKeys.period_end)
      .eq('status', 'pending')
      .maybeSingle()) as {
      data: RegenerationQueueRow | null;
      error: PostgrestError | null;
    };
    if (error) {
      throw new InternalServerErrorException(
        'Failed to check for existing regeneration request',
      );
    }
    return data;
  }

  private async loadTemplatesByIds(
    templateIds: number[],
  ): Promise<TemplateRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
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
    templateIds: number[],
  ): Promise<ScheduleRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_report_template_schedule')
      .select(
        'created_at, end_of_day, end_of_month, end_of_week, id, is_active, template_id, utc_offset',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load report schedule');
    }

    return data ?? [];
  }

  private async loadRecipientsByTemplateIds(
    templateIds: number[],
  ): Promise<RecipientRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_report_template_recipients')
      .select('communication_method, created_at, email, id, name, template_id')
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load report recipients',
      );
    }

    return data ?? [];
  }

  private async loadAlertPointsByTemplateIds(
    templateIds: number[],
  ): Promise<AlertPointRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_report_template_alert_points')
      .select(
        'created_at, data_point_key, hex_color, id, max, min, name, operator, template_id, value',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load report alert points',
      );
    }

    return data ?? [];
  }

  private async loadDataProcessingSchedulesByTemplateIds(
    templateIds: number[],
  ): Promise<DataProcessingScheduleRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
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

    return data ?? [];
  }

  private async replaceTemplateChildren(
    templateId: number,
    payload: NormalizedSaveRequest,
  ): Promise<void> {
    await this.deleteTemplateChildren(templateId);

    const client = this.supabaseService.getClient();

    const assignments = payload.devEuis.map((devEui) => ({
      dev_eui: devEui,
      template_id: templateId,
      is_active: true,
    }));
    const { error: assignmentsError } = await client
      .from('cw_device_report_assignments')
      .insert(assignments);
    if (assignmentsError) {
      throw new InternalServerErrorException(
        'Failed to save report assignments',
      );
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
        throw new InternalServerErrorException(
          'Failed to save report schedule',
        );
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
        throw new InternalServerErrorException(
          'Failed to save report recipients',
        );
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

  private async deleteTemplateChildren(templateId: number): Promise<void> {
    const client = this.supabaseService.getClient();
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
      throw new InternalServerErrorException(
        'Failed to remove report assignments',
      );
    }
    if (schedule.error) {
      throw new InternalServerErrorException(
        'Failed to remove report schedule',
      );
    }
    if (recipients.error) {
      throw new InternalServerErrorException(
        'Failed to remove report recipients',
      );
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

  private async deleteTemplateBestEffort(templateId: number): Promise<void> {
    try {
      await this.deleteTemplateChildren(templateId);
      await this.supabaseService
        .getClient()
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
  const {
    templates,
    assignments,
    schedule,
    recipients,
    alertPoints,
    dpSchedules,
    devices,
  } = args;

  const devicesById = new Map(devices.map((device) => [device.devEui, device]));
  const assignmentsByTemplateId = groupBy(
    assignments,
    (assignment) => assignment.template_id,
  );
  const scheduleByTemplateId = groupBy(schedule, (row) => row.template_id);
  const recipientsByTemplateId = groupBy(recipients, (row) => row.template_id);
  const alertPointsByTemplateId = groupBy(
    alertPoints,
    (row) => row.template_id,
  );
  const dpSchedulesByTemplateId = groupBy(
    dpSchedules,
    (row) => row.template_id,
  );

  return templates
    .map((template): ReportTemplateDto | null => {
      const templateAssignments =
        assignmentsByTemplateId.get(template.id) ?? [];
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
        schedule: (scheduleByTemplateId.get(template.id) ?? []).map(
          mapSchedule,
        ),
        recipients: (recipientsByTemplateId.get(template.id) ?? []).map(
          mapRecipient,
        ),
        alertPoints: (alertPointsByTemplateId.get(template.id) ?? []).map(
          mapAlertPoint,
        ),
        dataProcessingSchedules: (
          dpSchedulesByTemplateId.get(template.id) ?? []
        ).map(mapDataProcessingSchedule),
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

function toRegenerationItemDto(
  row: RegenerationQueueRow,
): ReportRegenerationItemDto {
  return {
    id: row.id,
    templateId: row.template_id,
    devEui: row.dev_eui,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    requestedAt: row.requested_at,
    editCount: row.edit_count ?? 1,
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

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
