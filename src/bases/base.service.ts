import { BaseRepository } from "src/repositories/base.repository";

// src/services/base.service.ts
export interface BaseServiceInterface<T, CreateDto> {
  findAll(): Promise<T[]>;
  create(dto: CreateDto): Promise<T>;
}

export class BaseService<T, CreateDto extends Partial<T>, UpdateDto extends Partial<T>> implements BaseServiceInterface<T, CreateDto> {
  constructor(protected readonly repository: BaseRepository<T>) {}

  async findAll(): Promise<T[]> {
    return this.repository.findAll();
  }

  async findById(id: number): Promise<T | null> {
    return this.repository.findById(id);
  }

  async create(dto: CreateDto): Promise<T> {
    return this.repository.create(dto);
  }

  async update(id: number, dto: UpdateDto): Promise<T> {
    return this.repository.update(id, dto);
  }

  async delete(id: number): Promise<void> {
    return this.repository.delete(id);
  }
}
