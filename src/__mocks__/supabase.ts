import { SupabaseClient, createClient } from '@supabase/supabase-js';

export const createMockSupabaseClient = (): SupabaseClient => {
  return {
    auth: {
      getUser: jest.fn(),
      signInWithPassword: jest.fn(),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    // Add other methods as needed
  } as unknown as SupabaseClient;
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => createMockSupabaseClient()),
}));
