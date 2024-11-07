import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase client
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn(),
      signInWithPassword: jest.fn(),
    },
    from: jest.fn(),
  })),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let supabaseClient: SupabaseClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SUPABASE_URL') return 'https://mock.supabase.co';
              if (key === 'SUPABASE_KEY') return 'mock-key';
            }),
          },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    supabaseClient = authService['supabase']; // Access the mock Supabase client
  });

  it('should validate user with a valid token', async () => {
    (supabaseClient.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: { user: { id: 'mock-user-id', email: 'mock@example.com' } },
      error: null,
    });

    const user = await authService.validateUser('mock-token');
    expect(user).toEqual({ id: 'mock-user-id', email: 'mock@example.com' });
    expect(supabaseClient.auth.getUser).toHaveBeenCalledWith('mock-token');
  });

  it('should throw an error for an invalid token', async () => {
    (supabaseClient.auth.getUser as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid token' },
    });

    await expect(authService.validateUser('invalid-token')).rejects.toThrow(
      'Invalid token',
    );
  });

  it('should throw an error when user provides invalid credentials', async () => {
    (supabaseClient.auth.signInWithPassword as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid login credentials' },
    });

    await expect(
      authService.signInWithEmail('invalid@example.com', 'wrong-password'),
    ).rejects.toThrow('Unable to sign in with email and password');

    expect(supabaseClient.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'invalid@example.com',
      password: 'wrong-password',
    });
  });
});
