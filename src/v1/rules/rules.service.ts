import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  getAccessToken,
  getUserId,
  isCropwatchStaff,
} from '../../supabase/supabase-token.helper';
import { count } from 'rxjs/internal/operators/count';
import { error } from 'console';

@Injectable()
export class RulesService {

  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  async create(createRuleDto: CreateRuleDto, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    if (!createRuleDto.dev_eui) {
      throw new BadRequestException('dev_eui must be provided');
    }

    const hasLocationPermission: boolean = await this.hasPermissionToLocation(userId, createRuleDto.dev_eui, accessToken, isGlobalUser);
    if (!hasLocationPermission) {
      throw new UnauthorizedException('User does not have permission to create this rule');
    }

    createRuleDto.profile_id = userId; // HARD FORCE THE profile_id FOR SECURITY, DO NOT TRUST THE CLIENT TO PROVIDE THE CORRECT profile_id
    const ruleInsertPayload = { ...createRuleDto };
    const ruleCriteria = createRuleDto.cw_rule_criteria;
    delete ruleInsertPayload.cw_rule_criteria;

    const { data: ruleData, error: ruleError } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .insert(ruleInsertPayload)
      .select('*')
      .single();
    if (ruleError || !ruleData) {
      throw new InternalServerErrorException('Failed to create rule');
    }


    if (ruleCriteria && ruleCriteria.length > 0) {
      // Remove 'id' from each criteria to ensure auto-increment works
      const ruleCriteriaInsertPayload = ruleCriteria.map(({ id, ...criteria }) => ({
        ...criteria,
        ruleGroupId: ruleData.ruleGroupId, // Associate criteria with the newly created rule's group ID
      }));

      const { error: criteriaError } = await this.supabaseService
        .getClient(accessToken)
        .from('cw_rule_criteria')
        .insert(ruleCriteriaInsertPayload);

      if (criteriaError) {
        // If criteria insertion fails, delete the previously created rule to maintain data integrity
        await this.supabaseService
          .getClient(accessToken)
          .from('cw_rules')
          .delete()
          .eq('id', ruleData.id);

        throw new InternalServerErrorException('Failed to create rule criteria');
      }
    }

    return ruleData;
  }

  async findAll(jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const client = this.supabaseService.getClient(accessToken);

    let query = client
      .from('cw_rules')
      .select('*, cw_rule_criteria(*), cw_devices(name, dev_eui, cw_locations(name, location_id))') // Fetch associated criteria for each rule
      .order('name', { ascending: true });

    if (!isGlobalUser) {
      query = query.eq('profile_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    return data;
  }

  async findAllTriggered(jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const client = this.supabaseService.getClient(accessToken);

    let query = client
      .from('cw_rules')
      .select('*, cw_rule_criteria(*), cw_devices(name, dev_eui, cw_locations(name, location_id))') // Fetch associated criteria for each rule
      .order('name', { ascending: true })
      .eq('is_triggered', true);

    if (!isGlobalUser) {
      query = query.eq('profile_id', userId);
    }

    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    return data;
  }

  async findTriggeredCount(jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const triggered = await this.findAllTriggered(jwtPayload, authHeader);
    if (!triggered) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    const totalRuleCount = await this.findAll(jwtPayload, authHeader);
    if (!totalRuleCount) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    const triggered_count = triggered.length;
    const total_count = totalRuleCount.length;

    return { triggered_count, total_count };
  }

  async findOne(id: number, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    let query = this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .select('*, cw_rule_criteria(*)')
      .eq('id', id);

    if (!isGlobalUser) {
      query = query.eq('profile_id', userId);
    }

    const { data, error } = await query.single();
    if (error) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    return data;
  }

  async update(ruleGroupId: string, updateRuleDto: UpdateRuleDto, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);
    const ruleUpdatePayload = { ...updateRuleDto };
    if (!isGlobalUser) {
      ruleUpdatePayload.profile_id = userId; // HARD FORCE THE profile_id FOR SECURITY, DO NOT TRUST THE CLIENT TO PROVIDE THE CORRECT profile_id
    } else {
      delete ruleUpdatePayload.profile_id;
    }
    delete ruleUpdatePayload.cw_rule_criteria; // Remove criteria from the main update payload, handle it separately

    const criteria = Array.isArray(updateRuleDto.cw_rule_criteria)
      ? [...updateRuleDto.cw_rule_criteria]
      : undefined;

    if (!criteria || criteria.length === 0) {
      throw new BadRequestException('At least one criteria must be provided to update a rule');
    }

    if (!updateRuleDto.dev_eui) {
      throw new BadRequestException('dev_eui must be provided');
    }
    const hasRulePermission: boolean = await this.hasPermissionToRule(userId, ruleGroupId, accessToken, isGlobalUser);
    if (!hasRulePermission) {
      throw new UnauthorizedException('User does not have permission to update this rule');
    }

    let updateQuery = this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .update(ruleUpdatePayload)
      .eq('ruleGroupId', ruleGroupId);

    if (!isGlobalUser) {
      updateQuery = updateQuery.eq('profile_id', userId);
    }

    const { error } = await updateQuery;
    if (error) {
      throw new InternalServerErrorException('Failed to update rule');
    }

    // handle criteria updates if provided
    if (criteria && criteria.length > 0) {
      if (!ruleGroupId) {
        throw new BadRequestException('ruleGroupId must be provided to update criteria');
      }
      const ruleCriteriaInsertPayload = criteria.map((criteria) => ({
        ...criteria,
        ruleGroupId: ruleGroupId,
      }));

      for (const criteria of ruleCriteriaInsertPayload) {
        const { error: criteriaError } = await this.supabaseService
          .getClient(accessToken)
          .from('cw_rule_criteria')
          .upsert(ruleCriteriaInsertPayload)
          .eq('id', criteria.id)
          .eq('ruleGroupId', ruleGroupId)
          .select('*');

        if (criteriaError) {
          throw new InternalServerErrorException('Failed to update rule criteria');
        }
      }
    }

    return updateRuleDto;
  }

  async remove(ruleGroupId: string, jwtPayload: any, authHeader: string) {
    const userId = getUserId(jwtPayload);
    const accessToken = getAccessToken(authHeader);
    const isGlobalUser = isCropwatchStaff(jwtPayload);

    const hasRulePermission: boolean = await this.hasPermissionToRule(userId, ruleGroupId, accessToken, isGlobalUser);
    if (!hasRulePermission) {
      throw new UnauthorizedException('User does not have permission to remove this rule');
    }

    let deleteQuery = this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .delete()
      .eq('ruleGroupId', ruleGroupId) // MUST HAVE THIS!!!!!
      .select('*');

    if (!isGlobalUser) {
      deleteQuery = deleteQuery.eq('profile_id', userId);
    }

    const { data, error } = await deleteQuery.single();

    if (error) {
      throw new InternalServerErrorException('Failed to remove rule');
    }

    return data;
  }

  private async hasPermissionToRule(
    userId: string,
    ruleGroupId: string,
    accessToken: string,
    isGlobalUser: boolean,
  ): Promise<boolean> {
    // Ensure the active user has permission to update the device & the location that the rule is associated with
    let query = this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .select('id, dev_eui, profile_id')
      .eq('ruleGroupId', ruleGroupId);

    if (!isGlobalUser) {
      query = query.eq('profile_id', userId);
    }

    const { data: existingRule, error: fetchError } = await query.single();

    if (fetchError || !existingRule) {
      throw new NotFoundException('Rule not found or user does not have permission to update this rule');
    }

    return true;
  }

  private async hasPermissionToLocation(
    userId: string,
    devEui: string,
    accessToken: string,
    isGlobalUser: boolean,
  ): Promise<boolean> {

    // Get the rule with the device eui in it.
    const { data: existingRule, error: existingRuleError } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_devices')
      .select('dev_eui')
      .eq('dev_eui', devEui)
      .single();
    if (existingRuleError || !existingRule) {
      throw new InternalServerErrorException('Failed to verify device permissions');
    }

    const { data: device, error: deviceError } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_devices')
      .select('location_id')
      .eq('dev_eui', existingRule.dev_eui)
      .single();
    if (deviceError || !device) {
      throw new InternalServerErrorException('Failed to verify device permissions');
    }

    if (isGlobalUser) {
      return true;
    }

    const { data: locationPermission, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_location_owners')
      .select('permission_level')
      .eq('user_id', userId)
      .eq('location_id', device.location_id)
      .eq('is_active', true)
      .single();
    if (fetchError || !locationPermission) {
      throw new NotFoundException('Rule not found or user does not have permission to update this rule');
    }

    if (locationPermission.permission_level > 2) {
      return false; // User does not have sufficient permissions to update the rule
    }


    return true;
  }
}
