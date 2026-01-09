import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class AuthService {
    constructor(private readonly supabaseService: SupabaseService) {}

    async loginWithPassword(email: string, password: string) {
        if (!email || !email.includes('@')) {
            throw new BadRequestException('Valid email is required');
        }
        if (!password) {
            throw new BadRequestException('Password is required');
        }

        const { data, error } =
            await this.supabaseService.getClient().auth.signInWithPassword({
                email,
                password,
            });

        if (error) {
            throw new BadRequestException(error.message);
        }

        return {
            message: 'Login successful.',
            data,
        };
    }
}
