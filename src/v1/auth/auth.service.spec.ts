import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseService } from '../../supabase/supabase.service';

describe('AuthService', () => {
  let service: AuthService;

  const mockSignIn = jest.fn();

  const mockClient = {
    auth: {
      signInWithPassword: mockSignIn,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            getAuthClient: jest.fn().mockReturnValue(mockClient),
            getClient: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('loginWithPassword', () => {
    it('should throw BadRequestException if the email is invalid', async () => {
      await expect(service.loginWithPassword('not-an-email', 'StrongPassword123!')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if the password is missing', async () => {
      await expect(service.loginWithPassword('john@example.com', '')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if supabase signInWithPassword returns error', async () => {
      mockSignIn.mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.loginWithPassword('john@example.com', 'StrongPassword123!')).rejects.toThrow(BadRequestException);
    });

    it('should return login metadata when sign in succeeds', async () => {
      mockSignIn.mockResolvedValue({
        data: {
          session: {
            access_token: 'token-abc',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: 1700000000,
          },
        },
        error: null,
      });

      const result = await service.loginWithPassword('john@example.com', 'StrongPassword123!');

      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'StrongPassword123!',
      });
      expect(result.message).toBe('Login successful.');
      expect(result.result.accessToken).toBe('token-abc');
    });
  });
});
