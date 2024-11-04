import { Injectable, Req } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Database } from 'database.types';
import { ApiBearerAuth } from '@nestjs/swagger';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

@Injectable()
export class ProfileRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  @ApiBearerAuth('JWT')
  async findById(id: string): Promise<ProfileRow | null> {
    const {data: user, error: userError } = await this.supabaseService.getSupabaseClient().auth.getUser(id);
    if (userError) {
      throw userError;
    }
    const { data, error } = await this.supabaseService
      .getSupabaseClient()
      .from('profiles')
      .select('*')
      .eq('id', user.user.id)
      .single();
    if (error) {
      throw error;
    }
    return data || null;
  }
}
