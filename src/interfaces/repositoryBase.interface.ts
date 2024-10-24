export interface IRepositoryBase<T> {
  findOne(id: number): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(entity: T): Promise<T>;
  update(id: number, entity: T): Promise<T | null>;
  remove(id: number): Promise<boolean>;
}


export interface RepositoryInterface<T> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(entity: T): Promise<T>;
  update(id: string, entity: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}
