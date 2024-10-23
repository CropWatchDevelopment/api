import { Injectable } from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { IRepositoryBase } from 'src/interfaces/repositoryBase.interface';

@Injectable()
export class RepositoryBaseService<T> implements IRepositoryBase<T> {
    constructor(private readonly authService: AuthService) { }
    findOne(id: number): Promise<T> {
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
