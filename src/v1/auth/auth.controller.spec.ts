import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    loginWithPassword: jest.fn(),
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
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('should call authService.loginWithPassword with the request body', async () => {
      const dto = {
        email: 'john@example.com',
        password: 'StrongPassword123!',
      };

      const expected = { message: 'Login successful.', result: {} };
      mockAuthService.loginWithPassword.mockResolvedValue(expected);

      const result = await controller.login(dto);

      expect(mockAuthService.loginWithPassword).toHaveBeenCalledWith(dto.email, dto.password);
      expect(result).toEqual(expected);
    });
  });
});
