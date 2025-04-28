import { BaseRepository } from '../repositories/base.repository';

export interface BaseServiceInterface<T, CreateDto, UpdateDto> {
  findAll(): Promise<T[]>;
  create(dto: CreateDto): Promise<T>;
  partialUpdate(id: number, dto: UpdateDto): Promise<T>;
  fullUpdate(id: number, dto: T | UpdateDto): Promise<T>; // Allow T or UpdateDto for full updates
}

export class BaseService<T, CreateDto extends Partial<T>, UpdateDto extends Partial<T>> implements BaseServiceInterface<T, CreateDto, UpdateDto> {
  constructor(protected readonly repository: BaseRepository<T>) {}

  async findAll(): Promise<T[]> {
    return this.repository.findAll();
  }

  async findById(id: number, idColumn: string | null = 'id'): Promise<T | null> {
    return this.repository.findById(id, idColumn);
  }

  async create(dto: CreateDto): Promise<T> {
    return this.repository.create(dto);
  }

  async partialUpdate(id: number, dto: UpdateDto): Promise<T> {
    return this.repository.partialUpdate(id, dto);
  }

  async fullUpdate(id: number, dto: T | UpdateDto): Promise<T> {
    return this.repository.fullUpdate(id, dto as T);
  }

  async delete(id: number): Promise<void> {
    return this.repository.delete(id);
  }
}
