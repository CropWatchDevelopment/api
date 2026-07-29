import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
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
import { RuleActionTypeDto } from './dto/rule-action-type.dto';
import { RuleFormContextDto } from './dto/rule-form-context.dto';
import { RuleTemplateActionDto } from './dto/rule-template-action.dto';
import { RuleTemplateAssignmentDto } from './dto/rule-template-assignment.dto';
import { RuleTemplateCriterionDto } from './dto/rule-template-criterion.dto';
import { RuleTemplateStateDto } from './dto/rule-template-state.dto';
import { RuleTemplateDto } from './dto/rule-template.dto';
import { RuleTriggerLogDto } from './dto/rule-trigger-log.dto';
import { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type TemplateRow = TableRow<'cw_rule_templates'>;
type TriggerLogRow = TableRow<'cw_rule_trigger_log'>;
type AssignmentRow = TableRow<'cw_device_rule_assignments'>;
type CriterionRow = TableRow<'cw_rule_template_criteria'>;
type ActionTypeRow = TableRow<'cw_rule_action_types'>;
type ActionTypeJoin = Pick<ActionTypeRow, 'id' | 'name'>;
type ActionRow = TableRow<'cw_rule_template_actions'> & {
  cw_rule_action_types?: ActionTypeJoin | ActionTypeJoin[] | null;
};
type StateRow = TableRow<'cw_rule_state'>;

interface NormalizedSaveRequest {
  name: string;
  description: string | null;
  deviceTypeId: number | null;
  isActive: boolean;
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
  ) {}

  async findAll(
    user: AuthenticatedUser,
    searchTerm?: string,
  ): Promise<RuleTemplateDto[]> {
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
      .from('cw_device_rule_assignments')
      .select(
        'created_at, dev_eui, id, is_active, template_id, cw_devices(cw_locations(name))',
      )
      .in(
        'dev_eui',
        viewableDevices.map((device) => device.devEui),
      );

    if (assignmentsError) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }

    const assignments = (assignmentsData ?? []) as AssignmentRow[];
    const templateIds = uniqueValues(assignments.map((row) => row.template_id));
    if (templateIds.length === 0) return [];

    const [templates, criteria, actions, states] = await Promise.all([
      this.loadTemplatesByIds(templateIds),
      this.loadCriteriaByTemplateIds(templateIds),
      this.loadActionsByTemplateIds(templateIds),
      this.loadStates(
        templateIds,
        assignments.map((row) => row.dev_eui),
      ),
    ]);

    const rules = buildRuleTemplates({
      templates,
      assignments,
      criteria,
      actions,
      states,
      devices,
    });

    const search = searchTerm?.trim().toLowerCase();
    if (!search) return rules;
    return rules.filter((rule) => matchesSearch(rule, search));
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
    const userId = user.sub;
    const isStaff = user.isStaff;

    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
    const viewableDevices = devices.filter((device) => device.canView);
    if (viewableDevices.length === 0) {
      throw new NotFoundException('Rule template not found');
    }

    const client = this.supabaseService.getClient();
    const [templateResult, assignmentsResult] = await Promise.all([
      client
        .from('cw_rule_templates')
        .select('created_at, description, device_type_id, id, is_active, name')
        .eq('id', id)
        .maybeSingle(),
      client
        .from('cw_device_rule_assignments')
        .select('created_at, dev_eui, id, is_active, template_id')
        .eq('template_id', id)
        .in(
          'dev_eui',
          viewableDevices.map((device) => device.devEui),
        ),
    ]);

    if (templateResult.error) {
      throw new InternalServerErrorException('Failed to load rule template');
    }
    if (assignmentsResult.error) {
      throw new InternalServerErrorException('Failed to load rule assignments');
    }
    if (!templateResult.data) {
      throw new NotFoundException('Rule template not found');
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
      templates: [templateResult.data],
      assignments,
      criteria,
      actions,
      states,
      devices,
    });

    if (!rule) {
      throw new NotFoundException('Rule template not found');
    }

    return rule;
  }

  async getHistory(
    id: number,
    user: AuthenticatedUser,
  ): Promise<RuleTriggerLogDto[]> {
    const userId = user.sub;
    const isStaff = user.isStaff;

    // Reuse findOne so a hidden or non-existent template returns 404 instead of
    // an empty list.
    await this.findOne(id, user);

    const devices = await listManagedDevices(
      this.supabaseService.getClient(),
      userId,
      isStaff,
    );
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
      .from('cw_rule_templates')
      .insert({
        name: normalized.name,
        description: normalized.description,
        device_type_id: normalized.deviceTypeId,
        is_active: normalized.isActive,
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

  async update(
    id: number,
    payload: SaveRuleTemplateDto,
    user: AuthenticatedUser,
  ): Promise<RuleTemplateDto> {
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
      .from('cw_rule_templates')
      .update({
        name: normalized.name,
        description: normalized.description,
        device_type_id: normalized.deviceTypeId,
        is_active: normalized.isActive,
      })
      .eq('id', id);

    if (updateError) {
      throw new InternalServerErrorException('Failed to update rule template');
    }

    await this.replaceTemplateChildren(id, normalized);
    await this.cleanupStateForUnassignedDevices(id, normalized.devEuis);

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

  private async loadTemplatesByIds(
    templateIds: number[],
  ): Promise<TemplateRow[]> {
    if (templateIds.length === 0) return [];

    const { data, error } = await this.supabaseService
      .getClient()
      .from('cw_rule_templates')
      .select('created_at, description, device_type_id, id, is_active, name')
      .in('id', templateIds);

    if (error) {
      throw new InternalServerErrorException('Failed to load rule templates');
    }

    return data ?? [];
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
    const [devicesPage, locations, actionTypes, template] = await Promise.all([
      this.devicesService.findAll(user),
      this.locationsService.findAll(user),
      this.findAllActionTypes(),
      typeof templateId === 'number'
        ? this.findOne(templateId, user)
        : Promise.resolve(null),
    ]);

    return {
      devices: devicesPage.data ?? [],
      locations: locations ?? [],
      actionTypes,
      template,
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
  devices: ManagedDevice[];
}): RuleTemplateDto[] {
  const { templates, assignments, criteria, actions, states, devices } = args;

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
      const ruleAssignments = assignmentsByTemplateId.get(template.id) ?? [];
      if (ruleAssignments.length === 0) return null;

      return {
        id: template.id,
        name: template.name,
        description: template.description,
        deviceTypeId: template.device_type_id,
        isActive: template.is_active ?? true,
        createdAt: template.created_at,
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

function mapAction(row: ActionRow): RuleTemplateActionDto {
  const rawJoin = row.cw_rule_action_types;
  const joined = Array.isArray(rawJoin)
    ? (rawJoin[0] ?? null)
    : (rawJoin ?? null);
  return {
    id: row.id,
    templateId: row.template_id,
    actionType: row.action_type,
    actionTypeName: joined?.name ?? null,
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

  const devEuis = uniqueValues(
    (payload.devEuis ?? [])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0),
  );
  if (devEuis.length === 0) {
    throw new BadRequestException('At least one device is required');
  }

  const criteria = (payload.criteria ?? []).map((entry, index) => {
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
  });
  if (criteria.length === 0) {
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

  return {
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
    isActive: typeof payload.isActive === 'boolean' ? payload.isActive : true,
    devEuis,
    criteria,
    actions,
  };
}

// PostgREST `not ... in` filters take a parenthesized, comma-separated list;
// values are quoted so EUIs survive as literals.
function toPostgrestList(values: string[]): string {
  return `(${values.map((value) => `"${value}"`).join(',')})`;
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
