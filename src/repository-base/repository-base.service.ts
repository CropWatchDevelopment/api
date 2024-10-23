import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { IRepositoryBase } from 'src/interfaces/repositoryBase.interface';
import { SupabaseService } from 'src/supabase/supabase.service';

@Injectable()
export class RepositoryBaseService<T> extends SupabaseService implements IRepositoryBase<T> {

    constructor(configService: ConfigService) {
        super(configService);
    }

    async findOne(id: number): Promise<T> {
        const supabase = this.getSupabaseClient();  // Access the Supabase client
        const { data, error } = await supabase
            .from(... something here)
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            throw new Error(`Error fetching data: ${error.message}`);
        }

        return data;
        throw new Error('Method not implemented.');
    }
    findAll(): Promise<T[]> {
        throw new Error('Method not implemented.');
    }
    create(entity: T): Promise<T> {
        throw new Error('Method not implemented.');
    }
    update(id: number, entity: T): Promise<T> {
        throw new Error('Method not implemented.');
    }
    remove(id: number): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

}
