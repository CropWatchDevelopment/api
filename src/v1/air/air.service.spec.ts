import { AirService } from './air.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';

describe('AirService', () => {
  let service: AirService;
  const single = jest.fn();
  const select = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select }));
  const from = jest.fn(() => ({ insert }));
  const defaultFrom = jest.fn();
  const mockSupabaseService = {
    getClient: jest.fn((accessToken?: string) =>
      accessToken
        ? { from }
        : {
            from: defaultFrom,
          },
    ),
  };

  beforeEach(async () => {
    service = new AirService(mockSupabaseService as any, {} as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNote', () => {
    it('uses the authenticated Supabase client for inserts', async () => {
      const dto: CreateAirAnnotationDto = {
        created_at: '2026-03-07T00:00:00.000Z',
        dev_eui: 'ABC123',
        note: 'stable reading',
      };
      const expected = { data: { ...dto, id: 1 }, error: null };

      single.mockResolvedValue(expected);

      await expect(service.createNote(dto, 'Bearer valid-token')).resolves.toEqual(
        expected,
      );
      expect(mockSupabaseService.getClient).toHaveBeenCalledWith('valid-token');
      expect(from).toHaveBeenCalledWith('cw_air_annotations');
      expect(insert).toHaveBeenCalledWith(dto);
      expect(defaultFrom).not.toHaveBeenCalled();
    });
  });
});
