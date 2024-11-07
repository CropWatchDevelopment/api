import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './DTOs/userAuth.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    validateUser: jest.fn(),
    signInWithEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should return a token if credentials are valid', async () => {
      const mockLoginDto: LoginDto = { email: 'user@example.com', password: 'password123' };
      const mockResponse = { message: 'Login successful', token: 'mock-token' };

      mockAuthService.signInWithEmail.mockResolvedValueOnce({
        session: { access_token: 'mock-token' },
      });

      const result = await controller.login(mockLoginDto);
      expect(result).toEqual(mockResponse);
      expect(authService.signInWithEmail).toHaveBeenCalledWith(mockLoginDto.email, mockLoginDto.password);
    });

    it('should throw an error if credentials are invalid', async () => {
      const mockLoginDto: LoginDto = { email: 'user@example.com', password: 'wrong-password' };

      mockAuthService.signInWithEmail.mockRejectedValueOnce(new Error('Invalid credentials'));

      await expect(controller.login(mockLoginDto)).rejects.toThrow('Invalid credentials');
      expect(authService.signInWithEmail).toHaveBeenCalledWith(mockLoginDto.email, mockLoginDto.password);
    });
  });

  describe('getProtectedRoute', () => {
    it('should return user data for a protected route', async () => {
      const mockUser = { id: 'mock-user-id', email: 'mock@example.com' };
      const mockRequest = { user: mockUser };

      const result = await controller.getProtectedRoute(mockRequest);
      expect(result).toEqual({ message: 'This is a protected route', user: mockUser });
    });
  });
});
