import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseService } from '../../supabase/supabase.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;
  let supabaseService: SupabaseService;

  const mockSignUp = jest.fn();
  const mockSignIn = jest.fn();
  const mockUpdate = jest.fn();
  const mockEq = jest.fn();

  const mockClient = {
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignIn,
    },
  };

  const mockAdminClient = {
    from: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: mockEq,
      }),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockEq.mockResolvedValue({ error: null });
    mockAdminClient.from.mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: mockEq,
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockClient),
            getAdminClient: jest.fn().mockReturnValue(mockAdminClient),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    supabaseService = module.get<SupabaseService>(SupabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const validDto: RegisterDto = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'StrongPassword123!',
      companyName: 'CropWatch Inc.',
      acceptedTerms: true,
      acceptedPrivacyPolicy: true,
      acceptedCookiePolicy: true,
    };

    it('should throw BadRequestException if terms are not accepted', async () => {
      const dto = { ...validDto, acceptedTerms: false };
      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if privacy policy is not accepted', async () => {
      const dto = { ...validDto, acceptedPrivacyPolicy: false };
      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if cookie policy is not accepted', async () => {
      const dto = { ...validDto, acceptedCookiePolicy: false };
      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if supabase signUp returns error', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'User already registered' },
      });

      await expect(service.register(validDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw InternalServerErrorException if no user is returned', async () => {
      mockSignUp.mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

      await expect(service.register(validDto)).rejects.toThrow(InternalServerErrorException);
    });

    it('should register successfully and update profile', async () => {
      mockSignUp.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: {
            access_token: 'token-abc',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: 1700000000,
          },
        },
        error: null,
      });

      const result = await service.register(validDto);

      expect(result.message).toBe('Registration successful.');
      expect(result.result.userId).toBe('user-123');
      expect(result.result.accessToken).toBe('token-abc');
      expect(mockAdminClient.from).toHaveBeenCalledWith('profiles');
    });

    it('should succeed even if profile update fails', async () => {
      mockSignUp.mockResolvedValue({
        data: {
          user: { id: 'user-123' },
          session: null,
        },
        error: null,
      });

      mockEq.mockResolvedValue({ error: { message: 'profile update failed' } });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const result = await service.register(validDto);

      expect(result.message).toBe('Registration successful.');
      expect(result.result.userId).toBe('user-123');
      consoleSpy.mockRestore();
    });
  });
});
