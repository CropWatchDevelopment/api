import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { TableRow } from '../types/supabase';
import { AccessService, type AccessibleDevice } from '../common/authz';
import {
  groupBy,
  matchesSearch,
  uniqueValues,
} from '../common/collection.helpers';
import { isStaffEmail } from '../common/owner-filter.helper';
import {
  addRuleRecipients,
  readRuleRecipients,
  ruleRecipientKind,
  splitStaffRecipients,
  writeRuleRecipients,
  type RuleRecipientKind,
} from '../common/staff-redaction.helper';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import { RuleActionTypeDto } from './dto/rule-action-type.dto';
import { RuleCatalogDto } from './dto/rule-catalog.dto';
import { RuleDeviceStateDto } from './dto/rule-device-state.dto';
import { RuleFormContextDto } from './dto/rule-form-context.dto';
import {
  RuleOptionDto,
  RuleRefDto,
  RuleScheduleDto,
  type RuleTriggerKind,
} from './dto/rule-status.dto';
import { RuleTemplateActionDto } from './dto/rule-template-action.dto';
import { RuleTemplateAssignmentDto } from './dto/rule-template-assignment.dto';
import { RuleTemplateCriterionDto } from './dto/rule-template-criterion.dto';
import { RuleTemplateStateDto } from './dto/rule-template-state.dto';
import { RuleTemplateDto } from './dto/rule-template.dto';
import { RuleTriggerLogDto } from './dto/rule-trigger-log.dto';
import { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import {
  NO_AUTO_PLAN,
  normalizeInstant,
  resolveAutoPlan,
  type RuleAutoPlanRequest,
} from './rule-auto-plan';
import {
  allowedOnDateTimeRule,
  readRelayDevEui,
  relayIsTimedPulse,
  readTargetTemplateId,
  ruleActionKind,
  switchesAnotherRule,
} from './rule-action-kinds';
import {
  normalizeSchedule,
  sameSchedule,
  timeOfDayFromDb,
  type RuleSchedule,
} from './rule-schedule';
import {
  computeRuleStatus,
  EMPTY_RULE_STATUS_CONTEXT,
  type RuleChainSource,
  type RuleStatusContext,
} from './rule-status';

// Only the columns the template selects fetch (the table also carries
// legacy_migration_key and last_action_activated_at, which this service never
// reads).
type TemplateRow = Pick<
  TableRow<'cw_rule_templates'>,
  | 'auto_pause_at'
  | 'auto_start_at'
  | 'created_at'
  | 'description'
  | 'device_type_id'
  | 'id'
  | 'is_active'
  | 'name'
  | 'on_auto_pause_start_template_id'
  | 'org_id'
  | 'resend_after_reports'
  | 'resend_max'
  | 'status_changed_at'
  | 'status_changed_by_template'
  | 'status_changed_by_user'
  | 'status_reason'
  | 'trigger_kind'
>;
const TEMPLATE_COLUMNS =
  'auto_pause_at, auto_start_at, created_at, description, device_type_id, id, is_active, name, on_auto_pause_start_template_id, org_id, resend_after_reports, resend_max, status_changed_at, status_changed_by_template, status_changed_by_user, status_reason, trigger_kind';
type ScheduleRow = Pick<
  TableRow<'cw_rule_template_schedules'>,
  | 'days_of_week'
  | 'last_fired_at'
  | 'next_fire_at'
  | 'template_id'
  | 'time_of_day'
  | 'timezone'
>;
const SCHEDULE_COLUMNS =
  'days_of_week, last_fired_at, next_fire_at, template_id, time_of_day, timezone';

/** A Date/Time rule: no devices, owned by an organization, run by the database tick. */
const isDateTimeRule = (row: Pick<TemplateRow, 'trigger_kind'>): boolean =>
  row.trigger_kind === 'schedule';

/** cw_rule_templates.resend_max's default (api update 044). */
const DEFAULT_RESEND_MAX = 5;

const SAME_ORGANIZATION_MESSAGE =
  'A rule can only start or pause a rule of the same organization, and all devices of both rules must belong to that organization';
const DATE_TIME_ORGANIZATION_MESSAGE =
  'Everything a Date/Time rule switches (rules and relays) must belong to one organization';
const DATE_TIME_MANAGERS_MESSAGE =
  'Only the owner and the managers of the organization can manage its Date/Time rules';
type TriggerLogRow = TableRow<'cw_rule_trigger_log'>;
type AssignmentRow = TableRow<'cw_device_rule_assignments'>;
type CriterionRow = TableRow<'cw_rule_template_criteria'>;
type ActionTypeRow = TableRow<'cw_rule_action_types'>;
type ActionTypeJoin = Pick<ActionTypeRow, 'id' | 'name'>;
type ActionRow = TableRow<'cw_rule_template_actions'> & {
  cw_rule_action_types?: ActionTypeJoin | ActionTypeJoin[] | null;
};
// The re-send counters of cw_rule_state are the alert service's; this service
// only resets them (see update).
type StateRow = Pick<
  TableRow<'cw_rule_state'>,
  | 'dev_eui'
  | 'id'
  | 'is_triggered'
  | 'last_reset_at'
  | 'last_triggered_at'
  | 'template_id'
>;

/** What a rule's actions are checked against. */
interface ActionSource {
  kind: RuleTriggerKind;
  /** null while the rule is being created. */
  templateId: number | null;
  /** A sensor rule's devices. */
  devEuis: string[];
}

interface NormalizedSaveRequest extends RuleAutoPlanRequest {
  /** 'sensor' unless the request says 'schedule'. */
  triggerKind: RuleTriggerKind;
  /** Set for a Date/Time rule only. */
  schedule: RuleSchedule | null;
  /** Re-send: undefined keeps the setting, null turns it off. */
  resendAfterReports: number | null | undefined;
  /** undefined keeps the cap. */
  resendMax: number | undefined;
  name: string;
  description: string | null;
  deviceTypeId: number | null;
  /** undefined: not sent. A new rule then runs; an existing one keeps its status. */
  isActive: boolean | undefined;
  devEuis: string[];
  criteria: SaveRuleTemplateDto['criteria'];
  actions: SaveRuleTemplateDto['actions'];
}

@Injectable()
export class RulesService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly devicesService: DevicesService,
    private readonly locationsService: LocationsService,
    private readonly accessService: AccessService,
  ) {}

  async findAll(
    user: AuthenticatedUser,
    searchTerm?: string,
  ): Promise<RuleTemplateDto[]> {
    const devices = await this.accessService.listAccessibleDevices(user);
    const viewableDevEuis = devices
      .filter((device) => device.canView)
      .map((device) => device.devEui);

    // Sensor rules come with the devices the caller can view; Date/Time rules
    // with the organizations the caller manages.
    const [assignments, dateTimeTemplates] = await Promise.all([
      this.loadViewableAssignments(viewableDevEuis),
      this.loadManagedDateTimeTemplates(user),
    ]);
    const sensorIds = uniqueValues(assignments.map((row) => row.template_id));
    const dateTimeIds = dateTimeTemplates.map((template) => template.id);
    if (sensorIds.length === 0 && dateTimeIds.length === 0) return [];

    const [sensorTemplates, criteria, actions, states, schedules] =
      await Promise.all([
        this.loadTemplatesByIds(sensorIds),
        this.loadCriteriaByTemplateIds(sensorIds),
        this.loadActionsByTemplateIds([...sensorIds, ...dateTimeIds]),
        this.loadStates(
          sensorIds,
          assignments.map((row) => row.dev_eui),
        ),
        this.loadSchedules(dateTimeIds),
      ]);
    const templates = [
      ...sensorTemplates.filter((template) => !isDateTimeRule(template)),
      ...dateTimeTemplates,
    ];

    const rules = buildRuleTemplates({
      templates,
      assignments,
      criteria,
      actions: await this.visibleActions(actions, user),
      states,
      devices,
      schedules,
      // Every rule the caller can see is in `templates`, so their names are known.
      statusContext: await this.loadStatusContext(templates, user, null),
    });

    const search = searchTerm?.trim().toLowerCase();
    if (!search) return rules;
    return rules.filter((rule) => matchesSearch(rule, search));
  }

  /** The rule assignments on the devices the caller can view. */
  private async loadViewableAssignments(
    viewableDevEuis: string[],
  ): Promise<AssignmentRow[]> {
    if (viewableDevEuis.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_device_rule_assignments')
      .select(
        'created_at, dev_eui, id, is_active, template_id, cw_devices(cw_locations(name))',
      )
      .in('dev_eui', viewableDevEuis);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }

    return data ?? [];
  }

  /** Staff, or the owner or a manager of that organization. */
  private async managesOrg(
    user: AuthenticatedUser,
    orgId: string | null,
  ): Promise<boolean> {
    if (!orgId) return false;
    if (user.isStaff) return true;
    return (await this.accessService.getManagedOrgIds(user)).includes(orgId);
  }

  /** The Date/Time rules of the organizations the caller manages (all of them for staff). */
  private async loadManagedDateTimeTemplates(
    user: AuthenticatedUser,
  ): Promise<TemplateRow[]> {
    const orgIds = user.isStaff
      ? null
      : await this.accessService.getManagedOrgIds(user);
    if (orgIds !== null && orgIds.length === 0) return [];

    let query = this.supabaseService
      .getClient()
      .from('cw_rule_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('trigger_kind', 'schedule');
    if (orgIds !== null) query = query.in('org_id', orgIds);
    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException('Failed to load rule templates');
    }

    return (data ?? []).filter(isDateTimeRule);
  }

  private async loadSchedules(templateIds: number[]): Promise<ScheduleRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_template_schedules')
      .select(SCHEDULE_COLUMNS)
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule schedules');
    }

    return data ?? [];
  }

  /**
   * Rule templates with at least one assignment whose live state is currently
   * triggered, narrowed to those triggered assignments. Visibility scoping is
   * inherited from findAll (device read scope).
   */
  async findAllTriggered(user: AuthenticatedUser): Promise<RuleTemplateDto[]> {
    const rules = await this.findAll(user);
    return rules
      .map((rule) => ({
        ...rule,
        assignments: rule.assignments.filter(
          (assignment) => assignment.state?.isTriggered === true,
        ),
      }))
      .filter((rule) => rule.assignments.length > 0);
  }

  /**
   * Lean rule catalog for field devices (ESP32 provisioning portal): each
   * visible template with its assigned devices, and nothing else — no
   * criteria, actions, or state. The full findAll() payload is tens of KB and
   * will not fit a microcontroller's buffers; this is a few hundred bytes.
   */
  async getCatalog(user: AuthenticatedUser): Promise<RuleCatalogDto> {
    const client = this.supabaseService.getClient();
    const devices = await this.accessService.listAccessibleDevices(user);
    const nameByDevEui = new Map(
      devices.filter((d) => d.canView).map((d) => [d.devEui, d.name]),
    );
    if (nameByDevEui.size === 0) return { rules: [] };

    const { data, error } = await client
      .from('cw_device_rule_assignments')
      .select(
        'dev_eui, template_id, is_active, cw_rule_templates(id, name, is_active)',
      )
      .in('dev_eui', [...nameByDevEui.keys()])
      .eq('is_active', true);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule catalog');
    }

    type Row = {
      dev_eui: string;
      template_id: number;
      cw_rule_templates?:
        | { id: number; name: string | null; is_active: boolean | null }
        | { id: number; name: string | null; is_active: boolean | null }[]
        | null;
    };

    const byTemplate = new Map<
      number,
      {
        templateId: number;
        name: string;
        devices: { devEui: string; name: string | null }[];
      }
    >();
    for (const row of (data ?? []) as Row[]) {
      const template = Array.isArray(row.cw_rule_templates)
        ? row.cw_rule_templates[0]
        : row.cw_rule_templates;
      if (!template || template.is_active === false) continue;
      let entry = byTemplate.get(row.template_id);
      if (!entry) {
        entry = {
          templateId: row.template_id,
          name: template.name ?? `Rule ${row.template_id}`,
          devices: [],
        };
        byTemplate.set(row.template_id, entry);
      }
      entry.devices.push({
        devEui: row.dev_eui,
        name: nameByDevEui.get(row.dev_eui) ?? null,
      });
    }

    return { rules: [...byTemplate.values()] };
  }

  /**
   * Lean polling endpoint for field devices (ECHONET bridges, ESP32 units):
   * current rule state for the requested devices only, flat and small.
   *
   * cw_rule_state rows are created lazily on first trigger, so only existing
   * rows are returned — a requested device with no row has never triggered and
   * callers must treat absence as isTriggered = false.
   */
  async getStateForDevices(
    user: AuthenticatedUser,
    devEuis: string[],
  ): Promise<RuleDeviceStateDto> {
    const ts = new Date().toISOString();
    const requested = uniqueValues(devEuis);
    if (requested.length === 0) return { ts, states: [] };

    const devices = await this.accessService.listAccessibleDevices(user);
    const viewable = new Set(
      devices.filter((device) => device.canView).map((d) => d.devEui),
    );
    // Non-visible devices are dropped silently rather than erroring, matching
    // how the rest of this service scopes reads.
    const visibleRequested = requested.filter((devEui) => viewable.has(devEui));
    if (visibleRequested.length === 0) return { ts, states: [] };

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_state')
      .select(
        'dev_eui, template_id, is_triggered, last_triggered_at, last_reset_at',
      )
      .in('dev_eui', visibleRequested);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule state');
    }

    type Row = {
      dev_eui: string;
      template_id: number;
      is_triggered: boolean;
      last_triggered_at: string | null;
      last_reset_at: string | null;
    };

    const states = ((data ?? []) as Row[]).map((row) => {
      const triggeredAt = row.last_triggered_at
        ? Date.parse(row.last_triggered_at)
        : null;
      const resetAt = row.last_reset_at ? Date.parse(row.last_reset_at) : null;
      const lastChange =
        triggeredAt === null && resetAt === null
          ? null
          : (triggeredAt ?? 0) >= (resetAt ?? 0)
            ? row.last_triggered_at
            : row.last_reset_at;
      return {
        devEui: row.dev_eui,
        templateId: row.template_id,
        isTriggered: row.is_triggered,
        lastChange,
      };
    });

    return { ts, states };
  }

  async findTriggeredCount(
    user: AuthenticatedUser,
  ): Promise<{ count: number; triggered_count: number; total_count: number }> {
    const rules = await this.findAll(user);
    const triggeredCount = rules.filter((rule) =>
      rule.assignments.some(
        (assignment) => assignment.state?.isTriggered === true,
      ),
    ).length;

    return {
      count: triggeredCount,
      // Kept for compatibility with consumers of the legacy /v1/rules/triggered/count shape.
      triggered_count: triggeredCount,
      total_count: rules.length,
    };
  }

  async findOne(id: number, user: AuthenticatedUser): Promise<RuleTemplateDto> {
    const devices = await this.accessService.listAccessibleDevices(user);
    const viewableDevEuis = devices
      .filter((device) => device.canView)
      .map((device) => device.devEui);

    const client = this.supabaseService.getClient();
    const templateResult = await client
      .from('cw_rule_templates')
      .select(TEMPLATE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (templateResult.error) {
      throw new InternalServerErrorException('Failed to load rule template');
    }
    const template = templateResult.data;
    if (!template) {
      throw new NotFoundException('Rule template not found');
    }

    if (isDateTimeRule(template)) {
      return this.findDateTimeRule(template, user, viewableDevEuis);
    }
    if (viewableDevEuis.length === 0) {
      throw new NotFoundException('Rule template not found');
    }

    const assignmentsResult = await client
      .from('cw_device_rule_assignments')
      .select('created_at, dev_eui, id, is_active, template_id')
      .eq('template_id', id)
      .in('dev_eui', viewableDevEuis);

    if (assignmentsResult.error) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }

    const assignments = (assignmentsResult.data ?? []) as AssignmentRow[];
    if (assignments.length === 0) {
      throw new NotFoundException('Rule template not found');
    }

    const [criteria, actions, states] = await Promise.all([
      this.loadCriteriaByTemplateIds([id]),
      this.loadActionsByTemplateIds([id]),
      this.loadStates(
        [id],
        assignments.map((row) => row.dev_eui),
      ),
    ]);

    const [rule] = buildRuleTemplates({
      templates: [template],
      assignments,
      criteria,
      actions: await this.visibleActions(actions, user),
      states,
      devices,
      schedules: [],
      statusContext: await this.loadStatusContext(
        [template],
        user,
        viewableDevEuis,
      ),
    });

    if (!rule) {
      throw new NotFoundException('Rule template not found');
    }

    return rule;
  }

  /** A Date/Time rule, for the people who manage its organization; 404 for everyone else. */
  private async findDateTimeRule(
    template: TemplateRow,
    user: AuthenticatedUser,
    viewableDevEuis: string[],
  ): Promise<RuleTemplateDto> {
    if (!(await this.managesOrg(user, template.org_id))) {
      throw new NotFoundException('Rule template not found');
    }

    const [actions, schedules] = await Promise.all([
      this.loadActionsByTemplateIds([template.id]),
      this.loadSchedules([template.id]),
    ]);

    const [rule] = buildRuleTemplates({
      templates: [template],
      assignments: [],
      criteria: [],
      actions: await this.visibleActions(actions, user),
      states: [],
      devices: [],
      schedules,
      statusContext: await this.loadStatusContext(
        [template],
        user,
        viewableDevEuis,
      ),
    });

    return rule;
  }

  async getHistory(
    id: number,
    user: AuthenticatedUser,
  ): Promise<RuleTriggerLogDto[]> {
    // Reuse findOne so a hidden or non-existent template returns 404 instead of
    // an empty list.
    await this.findOne(id, user);

    const devices = await this.accessService.listAccessibleDevices(user);
    const viewableDevices = devices.filter((device) => device.canView);
    const deviceNames = new Map(
      devices.map((device) => [device.devEui, device.name]),
    );

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_trigger_log')
      .select(
        'created_at, dev_eui, id, reset_at, reset_value, template_id, triggered_at, triggered_value',
      )
      .eq('template_id', id)
      .in(
        'dev_eui',
        viewableDevices.map((device) => device.devEui),
      )
      .order('triggered_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      throw new InternalServerErrorException(
        'Failed to load rule trigger history',
      );
    }

    return ((data ?? []) as TriggerLogRow[]).map((row) => ({
      id: row.id,
      devEui: row.dev_eui,
      deviceName: deviceNames.get(row.dev_eui) ?? null,
      templateId: row.template_id,
      triggeredAt: row.triggered_at,
      triggeredValue: row.triggered_value,
      resetAt: row.reset_at,
      resetValue: row.reset_value,
      createdAt: row.created_at,
    }));
  }

  async create(
    payload: SaveRuleTemplateDto,
    user: AuthenticatedUser,
  ): Promise<RuleTemplateDto> {
    const normalized = normalizeSaveRequest(payload);
    if (normalized.triggerKind === 'schedule') {
      return this.createDateTimeRule(normalized, user);
    }
    await this.accessService.assertDevicesManageable(user, normalized.devEuis);

    const source: ActionSource = {
      kind: 'sensor',
      templateId: null,
      devEuis: normalized.devEuis,
    };
    normalized.actions = await this.prepareSensorActions(
      user,
      source,
      normalized.actions,
    );

    const { plan } = resolveAutoPlan(normalized, NO_AUTO_PLAN, Date.now());
    if (plan.chainTemplateId !== null) {
      await this.assertChainTarget(user, source, null, plan.chainTemplateId);
    }

    const client = this.supabaseService.getClient();
    const { data: templateData, error: templateError } = (await client
      .from('cw_rule_templates')
      .insert({
        name: normalized.name,
        description: normalized.description,
        device_type_id: normalized.deviceTypeId,
        is_active: normalized.isActive ?? true,
        auto_start_at: plan.autoStartAt,
        auto_pause_at: plan.autoPauseAt,
        on_auto_pause_start_template_id: plan.chainTemplateId,
        // Only named when the request sets them; otherwise the column
        // defaults apply (re-send off, at most 5).
        ...resendColumns(normalized),
      })
      .select('created_at, description, device_type_id, id, is_active, name')
      .single()) as {
      data: Pick<
        TemplateRow,
        | 'created_at'
        | 'description'
        | 'device_type_id'
        | 'id'
        | 'is_active'
        | 'name'
      > | null;
      error: PostgrestError | null;
    };

    if (templateError || !templateData) {
      throw new InternalServerErrorException('Failed to create rule template');
    }

    try {
      await this.replaceTemplateChildren(templateData.id, normalized);
    } catch (error) {
      await this.deleteTemplateBestEffort(templateData.id);
      throw error;
    }

    return this.findOne(templateData.id, user);
  }

  /**
   * A Date/Time rule has no devices: it belongs to the organization of the
   * rules and relays it switches, which must be exactly one, and only that
   * organization's owner and managers (and staff) may create it. The time-zone
   * math is the database's: this only stores time, weekdays and zone.
   */
  private async createDateTimeRule(
    normalized: NormalizedSaveRequest,
    user: AuthenticatedUser,
  ): Promise<RuleTemplateDto> {
    const source: ActionSource = {
      kind: 'schedule',
      templateId: null,
      devEuis: [],
    };
    const { actions, orgIds } = await this.prepareActions(
      user,
      source,
      normalized.actions,
    );
    if (orgIds.length === 0) {
      throw new BadRequestException(
        'A Date/Time rule needs at least one action on another rule or on a relay',
      );
    }
    if (orgIds.length > 1) {
      throw new BadRequestException(DATE_TIME_ORGANIZATION_MESSAGE);
    }
    const orgId = orgIds[0];
    if (!(await this.managesOrg(user, orgId))) {
      throw new ForbiddenException(DATE_TIME_MANAGERS_MESSAGE);
    }

    const { plan } = resolveAutoPlan(normalized, NO_AUTO_PLAN, Date.now());
    if (plan.chainTemplateId !== null) {
      await this.assertChainTarget(user, source, orgId, plan.chainTemplateId);
    }

    const { data: templateData, error: templateError } =
      (await this.supabaseService
        .getClient()
        .from('cw_rule_templates')
        .insert({
          name: normalized.name,
          description: normalized.description,
          device_type_id: null,
          is_active: normalized.isActive ?? true,
          trigger_kind: 'schedule',
          org_id: orgId,
          auto_start_at: plan.autoStartAt,
          auto_pause_at: plan.autoPauseAt,
          on_auto_pause_start_template_id: plan.chainTemplateId,
        })
        .select('id')
        .single()) as {
        data: Pick<TemplateRow, 'id'> | null;
        error: PostgrestError | null;
      };

    if (templateError || !templateData) {
      throw new InternalServerErrorException('Failed to create rule template');
    }

    try {
      await this.writeSchedule(
        templateData.id,
        normalized.schedule as RuleSchedule,
        'insert',
      );
      await this.replaceActions(templateData.id, actions);
    } catch (error) {
      await this.deleteTemplateBestEffort(templateData.id);
      throw error;
    }

    return this.findOne(templateData.id, user);
  }

  async update(
    id: number,
    payload: SaveRuleTemplateDto,
    user: AuthenticatedUser,
  ): Promise<RuleTemplateDto> {
    const normalized = normalizeSaveRequest(payload);
    const existing = await this.findOne(id, user);

    if (normalized.triggerKind !== existing.triggerKind) {
      throw new BadRequestException(
        'A rule cannot be changed between a sensor rule and a Date/Time rule',
      );
    }
    if (existing.triggerKind === 'schedule') {
      return this.updateDateTimeRule(existing, normalized, user);
    }

    const allDevEuis = uniqueValues([
      ...existing.assignments.map((assignment) => assignment.devEui),
      ...normalized.devEuis,
    ]);
    await this.accessService.assertDevicesManageable(user, allDevEuis);

    const source: ActionSource = {
      kind: 'sensor',
      templateId: id,
      devEuis: normalized.devEuis,
    };
    normalized.actions = await this.prepareSensorActions(
      user,
      source,
      normalized.actions,
    );

    const { plan, update: planUpdate } = resolveAutoPlan(
      normalized,
      {
        autoStartAt: existing.autoStartAt,
        autoPauseAt: existing.autoPauseAt,
        chainTemplateId: existing.onAutoPauseStartTemplateId,
      },
      Date.now(),
    );
    const switchTo =
      normalized.isActive !== undefined &&
      normalized.isActive !== existing.isActive
        ? normalized.isActive
        : null;

    // Starting, pausing or scheduling touches every device of the rule, also
    // the ones this caller cannot see.
    if (switchTo !== null || Object.keys(planUpdate).length > 0) {
      await this.assertWholeRuleManageable(id, user);
    }
    if (
      plan.chainTemplateId !== null &&
      normalized.onAutoPauseStartTemplateId !== undefined
    ) {
      await this.assertChainTarget(user, source, null, plan.chainTemplateId);
    }

    // A pause takes effect before anything is rewritten; a start only after
    // the rule has been saved completely (see the end of this method).
    if (switchTo === false) {
      await this.switchRule(id, false, user);
    }

    // Only what changed: an unchanged setting must not reset running counts.
    const resendUpdate = resendColumns({
      resendAfterReports:
        normalized.resendAfterReports === existing.resendAfterReports
          ? undefined
          : normalized.resendAfterReports,
      resendMax:
        normalized.resendMax === existing.resendMax
          ? undefined
          : normalized.resendMax,
    });

    // is_active is never written here: cw_rule_switch owns it.
    const client = this.supabaseService.getClient();
    const { error: updateError } = await client
      .from('cw_rule_templates')
      .update({
        name: normalized.name,
        description: normalized.description,
        device_type_id: normalized.deviceTypeId,
        ...planUpdate,
        ...resendUpdate,
      })
      .eq('id', id);

    if (updateError) {
      throw new InternalServerErrorException('Failed to update rule template');
    }

    // A changed setting starts every open alarm of the rule counting afresh:
    // "every 3 reports, at most 5 times" must mean that from now on, not from
    // wherever the old setting had got to.
    if (Object.keys(resendUpdate).length > 0) {
      const { error: countersError } = await client
        .from('cw_rule_state')
        .update({
          reports_since_send: 0,
          resend_count: 0,
          last_counted_at: null,
          last_resend_at: null,
        })
        .eq('template_id', id);

      if (countersError) {
        throw new InternalServerErrorException(
          'Failed to reset the re-send counters',
        );
      }
    }

    // A customer never saw the staff recipients, so their save must not drop them.
    if (!user.isStaff) {
      normalized.actions = await this.withStaffRecipientsKept(
        id,
        normalized.actions,
      );
    }

    await this.replaceTemplateChildren(id, normalized);
    await this.cleanupStateForUnassignedDevices(id, normalized.devEuis);

    if (switchTo === true) {
      await this.switchRule(id, true, user);
    }

    return this.findOne(id, user);
  }

  /** Saves a Date/Time rule. findOne only handed it to someone who manages its organization. */
  private async updateDateTimeRule(
    existing: RuleTemplateDto,
    normalized: NormalizedSaveRequest,
    user: AuthenticatedUser,
  ): Promise<RuleTemplateDto> {
    const id = existing.id;
    const source: ActionSource = {
      kind: 'schedule',
      templateId: id,
      devEuis: [],
    };
    const { actions, orgIds } = await this.prepareActions(
      user,
      source,
      normalized.actions,
    );
    // The rule stays in its organization; what it switches must be there too.
    if (orgIds.some((orgId) => orgId !== existing.orgId)) {
      throw new BadRequestException(DATE_TIME_ORGANIZATION_MESSAGE);
    }

    const { plan, update: planUpdate } = resolveAutoPlan(
      normalized,
      {
        autoStartAt: existing.autoStartAt,
        autoPauseAt: existing.autoPauseAt,
        chainTemplateId: existing.onAutoPauseStartTemplateId,
      },
      Date.now(),
    );
    const switchTo =
      normalized.isActive !== undefined &&
      normalized.isActive !== existing.isActive
        ? normalized.isActive
        : null;
    if (
      plan.chainTemplateId !== null &&
      normalized.onAutoPauseStartTemplateId !== undefined
    ) {
      await this.assertChainTarget(
        user,
        source,
        existing.orgId,
        plan.chainTemplateId,
      );
    }

    if (switchTo === false) {
      await this.switchRule(id, false, user);
    }

    const { error: updateError } = await this.supabaseService
      .getClient()
      .from('cw_rule_templates')
      .update({
        name: normalized.name,
        description: normalized.description,
        ...planUpdate,
      })
      .eq('id', id);

    if (updateError) {
      throw new InternalServerErrorException('Failed to update rule template');
    }

    // Written only when it changed: writing it makes the database work out the
    // next run from "now", which would skip a run that is due this very minute.
    const schedule = normalized.schedule as RuleSchedule;
    if (!existing.schedule || !sameSchedule(existing.schedule, schedule)) {
      await this.writeSchedule(
        id,
        schedule,
        existing.schedule ? 'update' : 'insert',
      );
    }
    await this.replaceActions(id, actions);

    if (switchTo === true) {
      await this.switchRule(id, true, user);
    }

    return this.findOne(id, user);
  }

  /** Stores time, weekdays and zone; the database checks the zone and works out the next run. */
  private async writeSchedule(
    templateId: number,
    schedule: RuleSchedule,
    mode: 'insert' | 'update',
  ): Promise<void> {
    const values = {
      time_of_day: schedule.timeOfDay,
      days_of_week: schedule.daysOfWeek,
      timezone: schedule.timezone,
    };
    const table = this.supabaseService
      .getClient()
      .from('cw_rule_template_schedules');
    const { error } =
      mode === 'insert'
        ? await table.insert({ template_id: templateId, ...values })
        : await table.update(values).eq('template_id', templateId);

    if (!error) return;
    if (error.code === '22023' || error.message.includes('unknown time zone')) {
      throw new BadRequestException(
        'The time zone must be an IANA name such as Asia/Tokyo',
      );
    }
    throw new InternalServerErrorException('Failed to save the rule schedule');
  }

  /** A Date/Time rule's only children: its actions. */
  private async replaceActions(
    templateId: number,
    actions: NormalizedSaveRequest['actions'],
  ): Promise<void> {
    const client = this.supabaseService.getClient();
    const removed = await client
      .from('cw_rule_template_actions')
      .delete()
      .eq('template_id', templateId);
    if (removed.error) {
      throw new InternalServerErrorException('Failed to remove rule actions');
    }

    const inserted = await client.from('cw_rule_template_actions').insert(
      actions.map((entry) => ({
        template_id: templateId,
        action_type: entry.actionType,
        config: entry.config as never,
      })),
    );
    if (inserted.error) {
      throw new InternalServerErrorException('Failed to save rule actions');
    }
  }

  /**
   * Checks every action against what the rule may do, and tidies the configs
   * of the rule-switch actions. Returns the organizations of everything the
   * actions switch (target rules; for a Date/Time rule also its relays).
   *
   * A rule another rule starts or pauses must be one the caller manages in
   * full and must sit inside one organization; cw_rule_switch enforces the
   * organization again when the action runs.
   */
  private async prepareActions(
    user: AuthenticatedUser,
    source: ActionSource,
    actions: NormalizedSaveRequest['actions'],
  ): Promise<{ actions: NormalizedSaveRequest['actions']; orgIds: string[] }> {
    const typeNames = new Map(
      (await this.findAllActionTypes()).map((type) => [type.id, type.name]),
    );
    const prepared: NormalizedSaveRequest['actions'] = [];
    const orgIds: string[] = [];
    const relayDevEuis: string[] = [];

    for (const [index, action] of actions.entries()) {
      const label = `Action ${index + 1}`;
      if (!typeNames.has(action.actionType)) {
        throw new BadRequestException(`${label} has an unknown type`);
      }
      const kind = ruleActionKind(typeNames.get(action.actionType));

      if (source.kind === 'schedule' && !allowedOnDateTimeRule(kind)) {
        throw new BadRequestException(
          `${label}: a Date/Time rule can switch rules and relays, but cannot send notifications yet`,
        );
      }

      if (switchesAnotherRule(kind)) {
        const verb = kind === 'activate_rule' ? 'activate' : 'deactivate';
        const targetId = readTargetTemplateId(action.config);
        if (targetId === null) {
          throw new BadRequestException(`${label}: choose the rule to ${verb}`);
        }
        if (targetId === source.templateId) {
          throw new BadRequestException(
            `${label}: a rule cannot ${verb} itself this way`,
          );
        }
        orgIds.push(
          await this.manageableRuleOrg(
            user,
            targetId,
            `${label}: the rule to ${verb} was not found`,
          ),
        );
        prepared.push({
          ...action,
          config: { recipient: String(targetId), targetTemplateId: targetId },
        });
      } else if (kind === 'deactivate_self') {
        prepared.push({ ...action, config: { recipient: 'self' } });
      } else {
        if (kind === 'relay' && source.kind === 'schedule') {
          const devEui = readRelayDevEui(action.config);
          if (devEui === null) {
            throw new BadRequestException(
              `${label}: choose a relay and a command`,
            );
          }
          relayDevEuis.push(devEui);
        }
        prepared.push({
          ...action,
          config: withRepeatFlag(action.config, source.kind, kind, label),
        });
      }
    }

    if (relayDevEuis.length > 0) {
      const devEuis = uniqueValues(relayDevEuis);
      await this.accessService.assertDevicesManageable(user, devEuis);
      const relayOrg = await this.singleDeviceOrg(devEuis);
      if (relayOrg === null) {
        throw new BadRequestException(DATE_TIME_ORGANIZATION_MESSAGE);
      }
      orgIds.push(relayOrg);
    }

    return { actions: prepared, orgIds: uniqueValues(orgIds) };
  }

  /** A sensor rule's actions: the rules it switches must be in its own organization. */
  private async prepareSensorActions(
    user: AuthenticatedUser,
    source: ActionSource,
    actions: NormalizedSaveRequest['actions'],
  ): Promise<NormalizedSaveRequest['actions']> {
    const { actions: prepared, orgIds } = await this.prepareActions(
      user,
      source,
      actions,
    );
    if (orgIds.length > 0) {
      const ownOrg = await this.singleDeviceOrg(source.devEuis);
      if (ownOrg === null || orgIds.some((orgId) => orgId !== ownOrg)) {
        throw new BadRequestException(SAME_ORGANIZATION_MESSAGE);
      }
    }
    return prepared;
  }

  /**
   * Starts or pauses a rule by hand. Nothing else about the rule is rewritten,
   * so its actions keep their ids.
   */
  async setRunning(
    id: number,
    running: boolean,
    user: AuthenticatedUser,
  ): Promise<RuleTemplateDto> {
    // 404 for a rule the caller cannot see, before anything else.
    await this.findOne(id, user);
    await this.assertWholeRuleManageable(id, user);
    await this.switchRule(id, running, user);
    return this.findOne(id, user);
  }

  /**
   * The one place this service changes cw_rule_templates.is_active: the
   * cw_rule_switch database function also closes open alarms and records who
   * did it. Already in the requested state is fine ('noop').
   */
  private async switchRule(
    id: number,
    activate: boolean,
    user: AuthenticatedUser,
  ): Promise<void> {
    const { data, error } = (await this.supabaseService
      .getClient()
      .rpc('cw_rule_switch', {
        p_template_id: id,
        p_activate: activate,
        p_reason: 'manual',
        p_by_user: user.sub,
      })) as { data: string | null; error: PostgrestError | null };

    if (data === 'not_found') {
      throw new NotFoundException('Rule template not found');
    }
    if (error || (data !== 'changed' && data !== 'noop')) {
      throw new InternalServerErrorException(
        activate ? 'Failed to start the rule' : 'Failed to pause the rule',
      );
    }
  }

  /** Every device the rule is assigned to, also the ones the caller cannot see. */
  private async loadAssignedDevEuis(templateId: number): Promise<string[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_device_rule_assignments')
      .select('dev_eui')
      .eq('template_id', templateId);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }

    return uniqueValues(
      ((data ?? []) as Pick<AssignmentRow, 'dev_eui'>[]).map(
        (row) => row.dev_eui,
      ),
    );
  }

  private async assertWholeRuleManageable(
    templateId: number,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.accessService.assertDevicesManageable(
      user,
      await this.loadAssignedDevEuis(templateId),
    );
  }

  /**
   * The one organization all these devices belong to; null when there is none
   * (no devices, a device without an organization or without a row, or more
   * than one organization).
   */
  private async singleDeviceOrg(devEuis: string[]): Promise<string | null> {
    const unique = uniqueValues(devEuis);
    if (unique.length === 0) return null;

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_devices')
      .select('dev_eui, org_id')
      .in('dev_eui', unique);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule devices');
    }

    const rows = (data ?? []) as { dev_eui: string; org_id: string | null }[];
    const orgIds = new Set(rows.map((row) => row.org_id));
    const [orgId] = orgIds;
    return rows.length === unique.length && orgIds.size === 1 && orgId
      ? orgId
      : null;
  }

  /**
   * The organization of a rule the caller manages IN FULL: every device of a
   * sensor rule, or the organization of a Date/Time rule. Missing, without
   * devices, or not the caller's to manage all give the same "not found"; a
   * sensor rule that spans organizations can be switched by no rule.
   */
  private async manageableRuleOrg(
    user: AuthenticatedUser,
    templateId: number,
    notFoundMessage: string,
  ): Promise<string> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_templates')
      .select('id, org_id, trigger_kind')
      .eq('id', templateId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to load rule template');
    }
    // The service's client is untyped: name the columns' types here.
    const rule: Pick<TemplateRow, 'id' | 'org_id' | 'trigger_kind'> | null =
      data;
    if (!rule) {
      throw new NotFoundException(notFoundMessage);
    }

    if (isDateTimeRule(rule)) {
      if (!rule.org_id || !(await this.managesOrg(user, rule.org_id))) {
        throw new NotFoundException(notFoundMessage);
      }
      return rule.org_id;
    }

    const devEuis = await this.loadAssignedDevEuis(templateId);
    const devices = await this.accessService.listAccessibleDevices(user);
    const manageable = new Set(
      devices.filter((d) => d.canManage).map((d) => d.devEui),
    );
    if (
      devEuis.length === 0 ||
      devEuis.some((devEui) => !manageable.has(devEui))
    ) {
      throw new NotFoundException(notFoundMessage);
    }

    const orgId = await this.singleDeviceOrg(devEuis);
    if (orgId === null) {
      throw new BadRequestException(SAME_ORGANIZATION_MESSAGE);
    }
    return orgId;
  }

  /**
   * The rule to start after a pause date must be another rule that the caller
   * manages in full, in the same single organization as this rule.
   * cw_rule_switch enforces the organization again when the date arrives;
   * checking here turns a silent refusal later into an error now.
   */
  private async assertChainTarget(
    user: AuthenticatedUser,
    source: ActionSource,
    dateTimeOrgId: string | null,
    targetTemplateId: number,
  ): Promise<void> {
    if (targetTemplateId === source.templateId) {
      throw new BadRequestException('A rule cannot start itself');
    }

    const targetOrg = await this.manageableRuleOrg(
      user,
      targetTemplateId,
      'The rule to start was not found',
    );
    const ownOrg =
      source.kind === 'schedule'
        ? dateTimeOrgId
        : await this.singleDeviceOrg(source.devEuis);
    if (ownOrg === null || ownOrg !== targetOrg) {
      throw new BadRequestException(SAME_ORGANIZATION_MESSAGE);
    }
  }

  /**
   * Deletes a rule. When other rules start or pause it (a switch action, or
   * "then start" after a pause date) the delete is refused with the list of
   * those rules, unless `force` says the caller has seen it.
   */
  async remove(
    id: number,
    user: AuthenticatedUser,
    force = false,
  ): Promise<{ id: number }> {
    const existing = await this.findOne(id, user);
    // A Date/Time rule was only handed out to someone who manages its organization.
    await this.accessService.assertDevicesManageable(
      user,
      existing.assignments.map((assignment) => assignment.devEui),
    );

    if (!force) {
      const dependents = await this.findDependents(id, user);
      if (dependents.length > 0) {
        throw new ConflictException({
          message:
            'Other rules start or pause this rule. They will no longer find it once it is deleted.',
          dependents,
        });
      }
    }

    await this.deleteTemplateState(id);
    await this.closeOpenTriggerLogs(id);
    await this.deleteTemplateChildren(id);

    const client = this.supabaseService.getClient();
    const { error } = await client
      .from('cw_rule_templates')
      .delete()
      .eq('id', id);

    if (error) {
      throw new InternalServerErrorException('Failed to delete rule template');
    }

    return { id };
  }

  /** The rules that start or pause this one, named when the caller can see them. */
  private async findDependents(
    id: number,
    user: AuthenticatedUser,
  ): Promise<RuleRefDto[]> {
    const client = this.supabaseService.getClient();
    const [chains, actions] = await Promise.all([
      client
        .from('cw_rule_templates')
        .select('id')
        .eq('on_auto_pause_start_template_id', id),
      client
        .from('cw_rule_template_actions')
        .select('template_id, cw_rule_action_types(id, name)')
        .eq('config->>targetTemplateId', String(id)),
    ]);

    if (chains.error || actions.error) {
      throw new InternalServerErrorException('Failed to load rule dependents');
    }

    const ids = uniqueValues([
      ...((chains.data ?? []) as Pick<TemplateRow, 'id'>[]).map(
        (row) => row.id,
      ),
      ...((actions.data ?? []) as unknown as ActionRow[])
        .filter((row) =>
          switchesAnotherRule(ruleActionKind(readActionTypeName(row))),
        )
        .map((row) => row.template_id),
    ]).filter((dependentId) => dependentId !== id);
    if (ids.length === 0) return [];

    const devices = await this.accessService.listAccessibleDevices(user);
    const names = await this.loadVisibleRuleNames(
      ids,
      devices.filter((device) => device.canView).map((d) => d.devEui),
      user,
    );
    return ids.map((dependentId) => ({
      id: dependentId,
      name: names.get(dependentId) ?? null,
    }));
  }

  private async loadTemplatesByIds(
    templateIds: number[],
  ): Promise<TemplateRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_templates')
      .select(TEMPLATE_COLUMNS)
      .in('id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule templates');
    }

    return data ?? [];
  }

  /**
   * What the status of these rules refers to: who changed it, which rules
   * start them, and the names of the rules involved.
   *
   * `viewableDevEuis` is null when `templates` already holds every rule the
   * caller can see (the list); otherwise the rules referred to are looked up
   * and named only when the caller can see them.
   */
  private async loadStatusContext(
    templates: TemplateRow[],
    user: AuthenticatedUser,
    viewableDevEuis: string[] | null,
  ): Promise<RuleStatusContext> {
    if (templates.length === 0) return EMPTY_RULE_STATUS_CONTEXT;

    const [chainSources, userNames] = await Promise.all([
      this.loadChainSources(templates.map((template) => template.id)),
      this.loadStatusUserNames(
        templates.map((template) => template.status_changed_by_user),
        user,
      ),
    ]);

    const ruleNames = new Map(
      templates.map((template) => [template.id, template.name]),
    );
    if (viewableDevEuis !== null) {
      const referenced = uniqueValues(
        [
          ...templates.flatMap((template) => [
            template.on_auto_pause_start_template_id,
            template.status_changed_by_template,
          ]),
          ...[...chainSources.values()].flat().map((source) => source.id),
        ].filter((id): id is number => typeof id === 'number'),
      ).filter((id) => !ruleNames.has(id));
      const visibleNames = await this.loadVisibleRuleNames(
        referenced,
        viewableDevEuis,
        user,
      );
      for (const [id, name] of visibleNames) ruleNames.set(id, name);
    }

    return { userNames, ruleNames, chainSources };
  }

  /** Target rule id -> the rules that start it when their pause date arrives. */
  private async loadChainSources(
    targetIds: number[],
  ): Promise<Map<number, RuleChainSource[]>> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_templates')
      .select('id, auto_pause_at, on_auto_pause_start_template_id')
      .in('on_auto_pause_start_template_id', targetIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule status');
    }

    const sources = new Map<number, RuleChainSource[]>();
    for (const row of (data ?? []) as Pick<
      TemplateRow,
      'id' | 'auto_pause_at' | 'on_auto_pause_start_template_id'
    >[]) {
      const targetId = row.on_auto_pause_start_template_id;
      // The takeover only happens on a pause date.
      if (typeof targetId !== 'number' || !row.auto_pause_at) continue;
      const list = sources.get(targetId) ?? [];
      list.push({ id: row.id, at: row.auto_pause_at });
      sources.set(targetId, list);
    }
    return sources;
  }

  /**
   * Display names of the people who started or paused a rule. A customer never
   * gets the name of a CropWatch staff member.
   */
  private async loadStatusUserNames(
    userIds: (string | null | undefined)[],
    user: AuthenticatedUser,
  ): Promise<Map<string, string>> {
    const ids = uniqueValues(
      userIds.filter((id): id is string => typeof id === 'string'),
    );
    const names = new Map<string, string>();
    if (ids.length === 0) return names;

    const { data, error } = await this.supabaseService
      .getClient()
      .from('profiles')
      .select('id, email, full_name, username')
      .in('id', ids);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule status');
    }

    for (const profile of (data ?? []) as {
      id: string;
      email: string | null;
      full_name: string | null;
      username: string | null;
    }[]) {
      if (!user.isStaff && isStaffEmail(profile.email)) continue;
      const name = profile.full_name?.trim() || profile.username?.trim();
      if (name) names.set(profile.id, name);
    }
    return names;
  }

  /**
   * Names of the given rules, limited to the ones the caller can see: a sensor
   * rule through a device they can view, a Date/Time rule through an
   * organization they manage.
   */
  private async loadVisibleRuleNames(
    templateIds: number[],
    viewableDevEuis: string[],
    user: AuthenticatedUser,
  ): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    if (templateIds.length === 0) return names;

    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('cw_rule_templates')
      .select('id, name, org_id, trigger_kind')
      .in('id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule status');
    }
    const rows = (data ?? []) as Pick<
      TemplateRow,
      'id' | 'name' | 'org_id' | 'trigger_kind'
    >[];

    const sensorIds = rows
      .filter((row) => !isDateTimeRule(row))
      .map((row) => row.id);
    const visibleSensorIds = new Set<number>();
    if (sensorIds.length > 0 && viewableDevEuis.length > 0) {
      const { data: assignments, error: assignmentsError } = await client
        .from('cw_device_rule_assignments')
        .select('template_id')
        .in('template_id', sensorIds)
        .in('dev_eui', viewableDevEuis);

      if (assignmentsError) {
        throw new InternalServerErrorException('Failed to load rule status');
      }
      for (const row of (assignments ?? []) as Pick<
        AssignmentRow,
        'template_id'
      >[]) {
        visibleSensorIds.add(row.template_id);
      }
    }

    for (const row of rows) {
      const visible = isDateTimeRule(row)
        ? await this.managesOrg(user, row.org_id)
        : visibleSensorIds.has(row.id);
      if (visible) names.set(row.id, row.name);
    }
    return names;
  }

  /**
   * The rules another rule may start or pause: the ones the caller manages in
   * full (every device of a sensor rule; a Date/Time rule of an organization
   * they manage), each inside one organization.
   */
  private async listRuleOptions(
    user: AuthenticatedUser,
    excludeTemplateId?: number,
  ): Promise<RuleOptionDto[]> {
    const [sensorRules, dateTimeTemplates] = await Promise.all([
      this.listSensorRuleOptions(user),
      this.loadManagedDateTimeTemplates(user),
    ]);
    const dateTimeRules = dateTimeTemplates.flatMap(
      (template): RuleOptionDto[] =>
        template.org_id
          ? [
              {
                id: template.id,
                name: template.name,
                orgId: template.org_id,
                triggerKind: 'schedule',
              },
            ]
          : [],
    );

    return [...sensorRules, ...dateTimeRules]
      .filter((rule) => rule.id !== excludeTemplateId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async listSensorRuleOptions(
    user: AuthenticatedUser,
  ): Promise<RuleOptionDto[]> {
    const devices = await this.accessService.listAccessibleDevices(user);
    const manageable = new Set(
      devices.filter((d) => d.canManage).map((d) => d.devEui),
    );
    if (manageable.size === 0) return [];

    const client = this.supabaseService.getClient();
    const { data: mine, error: mineError } = await client
      .from('cw_device_rule_assignments')
      .select('template_id')
      .in('dev_eui', [...manageable]);

    if (mineError) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }

    const candidateIds = uniqueValues(
      ((mine ?? []) as Pick<AssignmentRow, 'template_id'>[]).map(
        (row) => row.template_id,
      ),
    );
    if (candidateIds.length === 0) return [];

    const [assignmentsResult, templatesResult] = await Promise.all([
      client
        .from('cw_device_rule_assignments')
        .select('dev_eui, template_id, cw_devices(org_id)')
        .in('template_id', candidateIds),
      client
        .from('cw_rule_templates')
        .select('id, name')
        .in('id', candidateIds),
    ]);

    if (assignmentsResult.error) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }
    if (templatesResult.error) {
      throw new InternalServerErrorException('Failed to load rule templates');
    }

    const assignmentsByTemplateId = groupBy(
      (assignmentsResult.data ?? []) as {
        dev_eui: string;
        template_id: number;
        cw_devices?: unknown;
      }[],
      (row) => row.template_id,
    );

    return (
      (templatesResult.data ?? []) as Pick<TemplateRow, 'id' | 'name'>[]
    ).flatMap((template): RuleOptionDto[] => {
      const rows = assignmentsByTemplateId.get(template.id) ?? [];
      const orgIds = new Set(
        rows.map((row) => unwrapJoin(row.cw_devices)?.org_id ?? null),
      );
      const [orgId] = orgIds;
      return rows.length > 0 &&
        rows.every((row) => manageable.has(row.dev_eui)) &&
        orgIds.size === 1 &&
        typeof orgId === 'string'
        ? [
            {
              id: template.id,
              name: template.name,
              orgId,
              triggerKind: 'sensor',
            },
          ]
        : [];
    });
  }

  private async loadCriteriaByTemplateIds(
    templateIds: number[],
  ): Promise<CriterionRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_template_criteria')
      .select(
        'created_at, id, operator, reset_value, subject, template_id, trigger_value',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule criteria');
    }

    return data ?? [];
  }

  private async loadActionsByTemplateIds(
    templateIds: number[],
  ): Promise<ActionRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_template_actions')
      .select(
        'action_type, config, created_at, id, template_id, cw_rule_action_types(id, name)',
      )
      .in('template_id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule actions');
    }

    return data ?? [];
  }

  /**
   * Decides whether a recipient is CropWatch staff: an address by its domain,
   * a LINE/Push user id by that user's profile email.
   */
  private async staffRecipientCheck(
    actions: ActionRow[],
  ): Promise<(kind: RuleRecipientKind, recipient: string) => boolean> {
    const userIds = uniqueValues(
      actions.flatMap((row) => {
        const kind = ruleRecipientKind(readActionTypeName(row));
        return kind === 'userIds' ? readRuleRecipients(kind, row.config) : [];
      }),
    );

    const staffUserIds = new Set<string>();
    if (userIds.length > 0) {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('profiles')
        .select('id, email')
        .in('id', userIds);
      if (error) {
        throw new InternalServerErrorException(
          'Failed to load rule recipients',
        );
      }
      for (const profile of (data ?? []) as {
        id: string;
        email: string | null;
      }[]) {
        if (isStaffEmail(profile.email)) staffUserIds.add(profile.id);
      }
    }

    return (kind, recipient) =>
      kind === 'email' ? isStaffEmail(recipient) : staffUserIds.has(recipient);
  }

  /**
   * The actions as a customer may see them: staff recipients removed, and an
   * action that only addresses staff left out. Staff see everything.
   */
  private async visibleActions(
    actions: ActionRow[],
    user: AuthenticatedUser,
  ): Promise<ActionRow[]> {
    if (user.isStaff) return actions;
    const isStaffRecipient = await this.staffRecipientCheck(actions);

    return actions.flatMap((row) => {
      const kind = ruleRecipientKind(readActionTypeName(row));
      if (!kind) return [row];
      const { visible, staff } = splitStaffRecipients(kind, row.config, (r) =>
        isStaffRecipient(kind, r),
      );
      if (staff.length === 0) return [row];
      if (visible.length === 0) return [];
      return [
        { ...row, config: writeRuleRecipients(kind, row.config, visible) },
      ];
    });
  }

  /**
   * A customer's save with the template's staff recipients put back: into the
   * same action when it is still there, otherwise as a staff-only action of
   * the same type.
   */
  private async withStaffRecipientsKept(
    templateId: number,
    actions: NormalizedSaveRequest['actions'],
  ): Promise<NormalizedSaveRequest['actions']> {
    const existing = await this.loadActionsByTemplateIds([templateId]);
    const isStaffRecipient = await this.staffRecipientCheck(existing);
    const kept = actions.map((action) => ({ ...action }));

    for (const row of existing) {
      const kind = ruleRecipientKind(readActionTypeName(row));
      if (!kind) continue;
      const { staff } = splitStaffRecipients(kind, row.config, (r) =>
        isStaffRecipient(kind, r),
      );
      if (staff.length === 0) continue;

      const target = kept.find(
        (action) =>
          action.id === row.id && action.actionType === row.action_type,
      );
      if (target) {
        target.config = addRuleRecipients(kind, target.config, staff);
      } else {
        kept.push({
          id: null,
          actionType: row.action_type,
          config: writeRuleRecipients(kind, row.config, staff),
        });
      }
    }

    return kept;
  }

  async findAllActionTypes(): Promise<RuleActionTypeDto[]> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_action_types')
      .select('created_at, id, name')
      .order('name', { ascending: true });

    if (error) {
      throw new InternalServerErrorException('Failed to load action types');
    }

    return ((data ?? []) as ActionTypeRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
    }));
  }

  async getFormContext(
    user: AuthenticatedUser,
    templateId?: number,
  ): Promise<RuleFormContextDto> {
    const [
      devicesPage,
      locations,
      actionTypes,
      template,
      ruleOptions,
      managedOrgIds,
    ] = await Promise.all([
      this.devicesService.findAll(user),
      this.locationsService.findAll(user),
      this.findAllActionTypes(),
      typeof templateId === 'number'
        ? this.findOne(templateId, user)
        : Promise.resolve(null),
      this.listRuleOptions(user, templateId),
      user.isStaff ? [] : this.accessService.getManagedOrgIds(user),
    ]);

    return {
      devices: devicesPage.data ?? [],
      locations: locations ?? [],
      actionTypes,
      template,
      ruleOptions,
      canManageDateTimeRules: user.isStaff || managedOrgIds.length > 0,
    };
  }

  private async loadStates(
    templateIds: number[],
    devEuis: string[],
  ): Promise<StateRow[]> {
    const uniqueDevEuis = uniqueValues(devEuis);
    if (templateIds.length === 0 || uniqueDevEuis.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_state')
      .select(
        'dev_eui, id, is_triggered, last_reset_at, last_triggered_at, template_id',
      )
      .in('template_id', templateIds)
      .in('dev_eui', uniqueDevEuis);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule state');
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
    const criteria = payload.criteria.map((entry) => ({
      template_id: templateId,
      subject: entry.subject,
      operator: entry.operator,
      trigger_value: entry.triggerValue,
      reset_value: entry.resetValue,
    }));
    const actions = payload.actions.map((entry) => ({
      template_id: templateId,
      action_type: entry.actionType,
      config: entry.config as never,
    }));

    const [assignmentsResult, criteriaResult, actionsResult] =
      await Promise.all([
        client.from('cw_device_rule_assignments').insert(assignments),
        client.from('cw_rule_template_criteria').insert(criteria),
        client.from('cw_rule_template_actions').insert(actions),
      ]);

    if (assignmentsResult.error) {
      throw new InternalServerErrorException('Failed to save rule assignments');
    }
    if (criteriaResult.error) {
      throw new InternalServerErrorException('Failed to save rule criteria');
    }
    if (actionsResult.error) {
      throw new InternalServerErrorException('Failed to save rule actions');
    }
  }

  private async deleteTemplateChildren(templateId: number): Promise<void> {
    const client = this.supabaseService.getClient();
    const [assignmentsResult, criteriaResult, actionsResult] =
      await Promise.all([
        client
          .from('cw_device_rule_assignments')
          .delete()
          .eq('template_id', templateId),
        client
          .from('cw_rule_template_criteria')
          .delete()
          .eq('template_id', templateId),
        client
          .from('cw_rule_template_actions')
          .delete()
          .eq('template_id', templateId),
      ]);

    if (assignmentsResult.error) {
      throw new InternalServerErrorException(
        'Failed to remove rule assignments',
      );
    }
    if (criteriaResult.error) {
      throw new InternalServerErrorException('Failed to remove rule criteria');
    }
    if (actionsResult.error) {
      throw new InternalServerErrorException('Failed to remove rule actions');
    }
  }

  private async deleteTemplateState(templateId: number): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('cw_rule_state')
      .delete()
      .eq('template_id', templateId);

    if (error) {
      throw new InternalServerErrorException('Failed to reset rule state');
    }
  }

  // State rows for devices that remain assigned must survive a template edit:
  // deleting them would erase is_triggered mid-alert, so the reset action and
  // trigger-log closure for that alert would never run.
  private async cleanupStateForUnassignedDevices(
    templateId: number,
    keepDevEuis: string[],
  ): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('cw_rule_state')
      .delete()
      .eq('template_id', templateId)
      .not('dev_eui', 'in', toPostgrestList(keepDevEuis));

    if (error) {
      throw new InternalServerErrorException('Failed to clean up rule state');
    }

    await this.closeOpenTriggerLogs(templateId, {
      excludeDevEuis: keepDevEuis,
    });
  }

  private async closeOpenTriggerLogs(
    templateId: number,
    opts?: { excludeDevEuis?: string[] },
  ): Promise<void> {
    // reset_value stays null: these rows are closed administratively, not by a
    // device reading that satisfied the reset criterion.
    let query = this.supabaseService
      .getClient()
      .from('cw_rule_trigger_log')
      .update({ reset_at: new Date().toISOString() })
      .eq('template_id', templateId)
      .is('reset_at', null);

    if (opts?.excludeDevEuis?.length) {
      query = query.not('dev_eui', 'in', toPostgrestList(opts.excludeDevEuis));
    }

    const { error } = await query;

    if (error) {
      throw new InternalServerErrorException(
        'Failed to close rule trigger logs',
      );
    }
  }

  private async deleteTemplateBestEffort(templateId: number): Promise<void> {
    try {
      await this.deleteTemplateChildren(templateId);
      await this.supabaseService
        .getClient()
        .from('cw_rule_templates')
        .delete()
        .eq('id', templateId);
    } catch {
      // The template was created but children/template cleanup failed; leaving
      // the orphan is preferable to surfacing the cleanup error to the caller.
    }
  }
}

function buildRuleTemplates(args: {
  templates: TemplateRow[];
  assignments: AssignmentRow[];
  criteria: CriterionRow[];
  actions: ActionRow[];
  states: StateRow[];
  devices: AccessibleDevice[];
  schedules: ScheduleRow[];
  statusContext: RuleStatusContext;
}): RuleTemplateDto[] {
  const {
    templates,
    assignments,
    criteria,
    actions,
    states,
    devices,
    schedules,
    statusContext,
  } = args;
  const schedulesByTemplateId = new Map(
    schedules.map((schedule) => [schedule.template_id, schedule]),
  );

  const devicesById = new Map(devices.map((device) => [device.devEui, device]));
  const assignmentsByTemplateId = groupBy(
    assignments,
    (assignment) => assignment.template_id,
  );
  const criteriaByTemplateId = groupBy(
    criteria,
    (criterion) => criterion.template_id,
  );
  const actionsByTemplateId = groupBy(actions, (action) => action.template_id);
  const statesByTemplateAndDevice = new Map(
    states.map((state) => [`${state.template_id}:${state.dev_eui}`, state]),
  );

  return templates
    .map((template): RuleTemplateDto | null => {
      const dateTime = isDateTimeRule(template);
      const ruleAssignments = assignmentsByTemplateId.get(template.id) ?? [];
      // A sensor rule is seen through its devices; a Date/Time rule has none.
      if (!dateTime && ruleAssignments.length === 0) return null;
      const schedule = schedulesByTemplateId.get(template.id);

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        deviceTypeId: template.device_type_id,
        isActive: template.is_active ?? true,
        createdAt: template.created_at,
        autoStartAt: template.auto_start_at ?? null,
        autoPauseAt: template.auto_pause_at ?? null,
        onAutoPauseStartTemplateId:
          template.on_auto_pause_start_template_id ?? null,
        status: computeRuleStatus(template, statusContext),
        triggerKind: dateTime ? 'schedule' : 'sensor',
        orgId: template.org_id ?? null,
        schedule: dateTime && schedule ? mapSchedule(schedule) : null,
        resendAfterReports: template.resend_after_reports ?? null,
        resendMax: template.resend_max ?? DEFAULT_RESEND_MAX,
        assignments: ruleAssignments.map(
          (assignment): RuleTemplateAssignmentDto => {
            const device = devicesById.get(assignment.dev_eui);
            const state = statesByTemplateAndDevice.get(
              `${assignment.template_id}:${assignment.dev_eui}`,
            );

            return {
              id: assignment.id,
              devEui: assignment.dev_eui,
              templateId: assignment.template_id,
              isActive: assignment.is_active ?? true,
              createdAt: assignment.created_at,
              deviceName: device?.name ?? null,
              locationName: readAssignmentLocationName(assignment),
              permissionLevel: device?.permissionLevel ?? null,
              state: state ? mapState(state) : null,
            };
          },
        ),
        criteria: (criteriaByTemplateId.get(template.id) ?? []).map(
          mapCriterion,
        ),
        actions: (actionsByTemplateId.get(template.id) ?? []).map(mapAction),
      };
    })
    .filter((rule): rule is RuleTemplateDto => rule !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapSchedule(row: ScheduleRow): RuleScheduleDto {
  return {
    timeOfDay: timeOfDayFromDb(row.time_of_day),
    daysOfWeek: [...row.days_of_week].sort((a, b) => a - b),
    timezone: row.timezone,
    nextFireAt: row.next_fire_at,
    lastFiredAt: row.last_fired_at,
  };
}

function mapCriterion(row: CriterionRow): RuleTemplateCriterionDto {
  return {
    id: row.id,
    templateId: row.template_id,
    subject: row.subject,
    operator: row.operator,
    triggerValue: row.trigger_value,
    resetValue: row.reset_value,
    createdAt: row.created_at,
  };
}

function readActionTypeName(row: ActionRow): string | null {
  const rawJoin = row.cw_rule_action_types;
  const joined = Array.isArray(rawJoin)
    ? (rawJoin[0] ?? null)
    : (rawJoin ?? null);
  return joined?.name ?? null;
}

function mapAction(row: ActionRow): RuleTemplateActionDto {
  return {
    id: row.id,
    templateId: row.template_id,
    actionType: row.action_type,
    actionTypeName: readActionTypeName(row),
    config: row.config,
    createdAt: row.created_at,
  };
}

function unwrapJoin(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) return (raw[0] as Record<string, unknown>) ?? null;
  return (raw as Record<string, unknown> | null) ?? null;
}

// findAll embeds cw_devices(cw_locations(name)) on each assignment row.
function readAssignmentLocationName(assignment: AssignmentRow): string | null {
  const device = unwrapJoin(
    (assignment as { cw_devices?: unknown }).cw_devices,
  );
  const location = unwrapJoin(device?.cw_locations);
  const name = location?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name : null;
}

function mapState(row: StateRow): RuleTemplateStateDto {
  return {
    id: row.id,
    devEui: row.dev_eui,
    templateId: row.template_id,
    isTriggered: row.is_triggered,
    lastTriggeredAt: row.last_triggered_at,
    lastResetAt: row.last_reset_at,
  };
}

function normalizeSaveRequest(
  payload: SaveRuleTemplateDto,
): NormalizedSaveRequest {
  const name = (payload.name ?? '').trim();
  if (!name) {
    throw new BadRequestException('Rule name is required');
  }

  // A Date/Time rule has a schedule instead of devices and conditions.
  const dateTime = payload.triggerKind === 'schedule';
  const schedule = dateTime ? normalizeSchedule(payload.schedule) : null;

  const devEuis = dateTime
    ? []
    : uniqueValues(
        (payload.devEuis ?? [])
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0),
      );
  if (!dateTime && devEuis.length === 0) {
    throw new BadRequestException('At least one device is required');
  }

  const criteria = (dateTime ? [] : (payload.criteria ?? [])).map(
    (entry, index) => {
      const subject = (entry.subject ?? '').trim();
      const operator = (entry.operator ?? '').trim();
      if (
        !subject ||
        !operator ||
        !Number.isFinite(entry.triggerValue) ||
        !Number.isFinite(entry.resetValue)
      ) {
        throw new BadRequestException(
          `Condition ${index + 1} must include a field, operator, trigger value, and reset value`,
        );
      }
      return {
        id: entry.id ?? null,
        subject,
        operator,
        triggerValue: entry.triggerValue,
        resetValue: entry.resetValue,
      };
    },
  );
  if (!dateTime && criteria.length === 0) {
    throw new BadRequestException('At least one condition is required');
  }

  const actions = (payload.actions ?? []).map((entry, index) => {
    const actionType = entry.actionType;
    if (!Number.isInteger(actionType)) {
      throw new BadRequestException(`Action ${index + 1} needs a type`);
    }
    return {
      id: entry.id ?? null,
      actionType,
      config: entry.config ?? null,
    };
  });
  if (actions.length === 0) {
    throw new BadRequestException('At least one action is required');
  }

  const resendAfterReports = normalizeResendAfterReports(
    payload.resendAfterReports,
  );
  if (dateTime && typeof resendAfterReports === 'number') {
    throw new BadRequestException(
      'A Date/Time rule has no reports to count, so it cannot re-send',
    );
  }

  return {
    triggerKind: dateTime ? 'schedule' : 'sensor',
    schedule,
    resendAfterReports,
    resendMax: normalizeResendMax(payload.resendMax),
    name,
    description:
      typeof payload.description === 'string' && payload.description.trim()
        ? payload.description.trim()
        : null,
    deviceTypeId:
      typeof payload.deviceTypeId === 'number' &&
      Number.isFinite(payload.deviceTypeId)
        ? payload.deviceTypeId
        : null,
    isActive:
      typeof payload.isActive === 'boolean' ? payload.isActive : undefined,
    autoStartAt: normalizeInstant(payload.autoStartAt, 'The start date'),
    autoPauseAt: normalizeInstant(payload.autoPauseAt, 'The pause date'),
    onAutoPauseStartTemplateId:
      payload.onAutoPauseStartTemplateId === undefined ||
      payload.onAutoPauseStartTemplateId === null
        ? payload.onAutoPauseStartTemplateId
        : assertTemplateId(payload.onAutoPauseStartTemplateId),
    devEuis,
    criteria,
    actions,
  };
}

/** Re-send every N reports: undefined keeps the setting, null turns it off, else 3..1000. */
function normalizeResendAfterReports(
  value: unknown,
): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 3 ||
    value > 1000
  ) {
    throw new BadRequestException(
      'Re-send needs a whole number of reports between 3 and 1000',
    );
  }
  return value;
}

/** At most N re-sends per alarm: undefined keeps the setting, else 1..50. */
function normalizeResendMax(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 50
  ) {
    throw new BadRequestException(
      'The number of re-sends must be a whole number between 1 and 50',
    );
  }
  return value;
}

/** The re-send columns a request sets (none when it does not mention them). */
function resendColumns(request: {
  resendAfterReports: number | null | undefined;
  resendMax: number | undefined;
}): { resend_after_reports?: number | null; resend_max?: number } {
  return {
    ...(request.resendAfterReports === undefined
      ? {}
      : { resend_after_reports: request.resendAfterReports }),
    ...(request.resendMax === undefined
      ? {}
      : { resend_max: request.resendMax }),
  };
}

/**
 * An action's `config.repeat`: whether a re-send sends it again. It must be a
 * boolean when present. A Date/Time rule never re-sends, so there it is
 * dropped; a relay repeats only as a timed pulse, so any other relay command
 * is stored as "not repeated".
 */
function withRepeatFlag(
  config: SaveRuleTemplateDto['actions'][number]['config'],
  kind: RuleTriggerKind,
  actionKind: ReturnType<typeof ruleActionKind>,
  label: string,
): SaveRuleTemplateDto['actions'][number]['config'] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config;
  }
  const { repeat, ...rest } = config as Record<string, unknown>;
  if (repeat === undefined) return config;
  if (typeof repeat !== 'boolean') {
    throw new BadRequestException(`${label}: "repeat" must be true or false`);
  }
  if (kind === 'schedule') {
    return rest as SaveRuleTemplateDto['actions'][number]['config'];
  }
  return {
    ...rest,
    repeat: repeat && (actionKind !== 'relay' || relayIsTimedPulse(config)),
  };
}

function assertTemplateId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException('The rule to start is not valid');
  }
  return value;
}

// PostgREST `not ... in` filters take a parenthesized, comma-separated list;
// values are quoted so EUIs survive as literals.
function toPostgrestList(values: string[]): string {
  return `(${values.map((value) => `"${value}"`).join(',')})`;
}
