import { InternalServerErrorException } from '@nestjs/common';
import type { PostgrestError } from '@supabase/supabase-js';

/** PostgREST page size (the project's max-rows default). */
export const POSTGREST_PAGE_SIZE = 1000;

export type PostgrestPage<T> = {
  data: T[] | null;
  error: PostgrestError | null;
};

/**
 * Reads every page of a query (PostgREST caps responses at max-rows). Order
 * the query by a unique column so the pages neither overlap nor skip rows.
 */
export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PostgrestPage<T>>,
  errorMessage: string,
  onError?: (error: PostgrestError) => void,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await page(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) {
      onError?.(error);
      throw new InternalServerErrorException(errorMessage);
    }
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < POSTGREST_PAGE_SIZE) return rows;
  }
}
