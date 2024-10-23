export interface IRepositoryBase<T> {
    findOne(id: number): Promise<T | null>;
    findAll(): Promise<T[]>;
    create(entity: T): Promise<T>;
    update(id: number, entity: T): Promise<T | null>;
    remove(id: number): Promise<boolean>;
  }