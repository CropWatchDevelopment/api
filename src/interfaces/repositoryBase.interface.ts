export interface IRepositoryBase<T> {
    findOne(id: string): Promise<T | null>;
    findAll(): Promise<T[]>;
    create(entity: T): Promise<T>;
    update(id: string, entity: T): Promise<T | null>;
    remove(id: string): Promise<boolean>;
  }