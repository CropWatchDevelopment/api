import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class RulesService {

  constructor(
    private readonly supabaseService: SupabaseService,
  ) { }

  async create(createRuleDto: CreateRuleDto, jwtPayload: any, authHeader: string) {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);

    if (!createRuleDto.dev_eui) {
      throw new BadRequestException('dev_eui must be provided');
    }

    const hasLocationPermission: boolean = await this.hasPermissionToLocation(userId, createRuleDto.dev_eui, accessToken);
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
      const ruleCriteriaInsertPayload = ruleCriteria.map((criteria) => ({
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
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('cw_rules')
      .select('*, cw_rule_criteria(*)') // Fetch associated criteria for each rule
      .order('name', { ascending: true })
      .eq('profile_id', userId);
    if (error) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    return data;
  }

  async findOne(id: number, jwtPayload: any, authHeader: string) {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .select('*, cw_rule_criteria(*)')
      .eq('profile_id', userId)
      .eq('id', id)
      .single();
    if (error) {
      throw new InternalServerErrorException('Failed to fetch rules');
    }

    return data;
  }

  async update(ruleId: number, updateRuleDto: UpdateRuleDto, jwtPayload: any, authHeader: string) {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);
    const ruleUpdatePayload = { ...updateRuleDto };
    ruleUpdatePayload.profile_id = userId; // HARD FORCE THE profile_id FOR SECURITY, DO NOT TRUST THE CLIENT TO PROVIDE THE CORRECT profile_id
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
    const hasRulePermission: boolean = await this.hasPermissionToRule(userId, ruleId, accessToken);
    if (!hasRulePermission) {
      throw new UnauthorizedException('User does not have permission to update this rule');
    }

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .update(ruleUpdatePayload)
      .eq('profile_id', userId)
      .eq('id', ruleId);
    if (error) {
      throw new InternalServerErrorException('Failed to update rule');
    }

    // handle criteria updates if provided
    if (criteria && criteria.length > 0) {
      if (!ruleUpdatePayload.ruleGroupId) {
        throw new BadRequestException('ruleGroupId must be provided to update criteria');
      }
      const ruleCriteriaInsertPayload = criteria.map((criteria) => ({
        ...criteria,
        ruleGroupId: ruleUpdatePayload.ruleGroupId,
      }));


      const { error: criteriaError } = await this.supabaseService
        .getClient(accessToken)
        .from('cw_rule_criteria')
        .upsert(ruleCriteriaInsertPayload)
        .eq('ruleGroupId', ruleUpdatePayload.ruleGroupId)
        .select('*');

      if (criteriaError) {
        throw new InternalServerErrorException('Failed to update rule criteria');
      }
    }

    return updateRuleDto;
  }

  async remove(id: number, jwtPayload: any, authHeader: string) {
    const userId = this.getUserId(jwtPayload);
    const accessToken = this.getAccessToken(authHeader);

    const hasRulePermission: boolean = await this.hasPermissionToRule(userId, +id, accessToken);
    if (!hasRulePermission) {
      throw new UnauthorizedException('User does not have permission to remove this rule');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .delete()
      .eq('profile_id', userId)
      .eq('id', id) // MUST HAVE THIS!!!!!
      .select('*')
      .single();

    if (error) {
      throw new InternalServerErrorException('Failed to remove rule');
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

  private async hasPermissionToRule(
    userId: string,
    ruleId: number,
    accessToken: string,
  ): Promise<boolean> {
    // Ensure the active user has permission to update the device & the location that the rule is associated with
    const { data: existingRule, error: fetchError } = await this.supabaseService
      .getClient(accessToken)
      .from('cw_rules')
      .select('id, dev_eui, profile_id')
      .eq('profile_id', userId)
      .eq('id', ruleId)
      .single();

    if (fetchError || !existingRule) {
      throw new NotFoundException('Rule not found or user does not have permission to update this rule');
    }

    return true;
  }

  private async hasPermissionToLocation(
    userId: string,
    devEui: string,
    accessToken: string,
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
