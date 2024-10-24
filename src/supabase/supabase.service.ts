import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from 'database.types';

@Injectable()
export class SupabaseService {
    private supabase: SupabaseClient;

    constructor(private configService: ConfigService) {
        const supabaseUrl = this.configService.get<string>('SUPABASE_URL');
        const supabaseKey = this.configService.get<string>('SUPABASE_KEY');

        // Initialize Supabase client with version 2 package
        this.supabase = createClient<Database>(supabaseUrl, supabaseKey);
    }

    getSupabaseClient(): SupabaseClient {
        return this.supabase;
    }
}
