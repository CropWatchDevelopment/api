import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AirController } from './air.controller';
import { AirService } from './air.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';

describe('AirController', () => {
  let controller: AirController;
  const mockAirService = {
    createNote: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AirController],
      providers: [
        {
          provide: AirService,
          useValue: mockAirService,
        },
      ],
    }).compile();

    controller = module.get<AirController>(AirController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createNote', () => {
    it('passes the request body and authenticated user to the service', async () => {
      const dto: CreateAirAnnotationDto = {
        created_at: '2026-03-07T00:00:00.000Z',
        dev_eui: 'ABC123',
        include_in_report: true,
        note: 'stable reading',
        title: 'Daily review',
      };
      const user = {
        sub: 'user-123',
        email: 'user@example.com',
        isStaff: false,
      };
      const expected = { data: { ...dto, id: 1 }, error: null };

      mockAirService.createNote.mockResolvedValue(expected);

      await expect(controller.createNote(dto, user)).resolves.toEqual(expected);
      expect(mockAirService.createNote).toHaveBeenCalledWith(dto, user);
    });

    it('accepts a valid payload under the global validation pipe settings', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });
      const payload = {
        created_at: '2026-03-07T00:00:00.000Z',
        dev_eui: 'ABC123',
        include_in_report: true,
        note: 'stable reading',
        title: 'Daily review',
      };

      const result = await pipe.transform(payload, {
        type: 'body',
        metatype: CreateAirAnnotationDto,
        data: '',
      });

      expect(result).toBeInstanceOf(CreateAirAnnotationDto);
      expect(result).toMatchObject(payload);
    });
  });
});
