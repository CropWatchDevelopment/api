import { Injectable, Req } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ProfileRow } from 'src/common/database-types';

@Injectable()
export class ProfileRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  @ApiBearerAuth('JWT')
  async findById(id: string): Promise<ProfileRow | null> {
    // const {data: user, error: userError } = await this.supabaseService.getSupabaseClient().auth.getUser(id);
    // if (userError) {
    //   throw userError;
    // }
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('profiles')
      .select('*')
      .eq('id',  id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }
}
