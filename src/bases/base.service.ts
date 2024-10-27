import { BaseRepository } from "src/repositories/base.repository";

export class BaseService<T, CreateDto extends Partial<T>, UpdateDto extends Partial<T>> {
    constructor(protected readonly repository: BaseRepository<T>) {}
  
    async findAll(): Promise<T[]> {
      return this.repository.findAll();
    }
  
    async findById(id: number): Promise<T | null> {
      return this.repository.findById(id);
    }
  
    async create(createDto: CreateDto): Promise<T> {
      return this.repository.create(createDto);
    }
  
    async update(id: number, updateDto: UpdateDto): Promise<T> {
      return this.repository.update(id, updateDto);
    }
  
    async delete(id: number): Promise<void> {
      return this.repository.delete(id);
    }
  }