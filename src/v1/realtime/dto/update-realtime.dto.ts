import { TableUpdate } from '../../types/supabase';

export type UpdateRealtimeDto = TableUpdate<'cw_relay_data'> & { id: number };
