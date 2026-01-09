import { Database } from '../../database.types';

type PublicSchema = Database['public'];
type Tables = PublicSchema['Tables'];

export type TableName = keyof Tables;
export type TableRow<T extends TableName> = Tables[T]['Row'];
export type TableInsert<T extends TableName> = Tables[T]['Insert'];
export type TableUpdate<T extends TableName> = Tables[T]['Update'];
