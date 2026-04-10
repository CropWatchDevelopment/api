import { BadRequestException } from '@nestjs/common';
import { AirService } from './air.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';

function createExactMatchBuilder(response: {
  data: { created_at: string } | null;
  error: { message: string } | null;
}) {
  return {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(response),
    select: jest.fn().mockReturnThis(),
  };
}

function createResolutionBuilder(response: {
  data: { created_at: string }[];
  error: { message: string } | null;
}) {
  return {
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(response),
    lt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  };
}

function createInsertBuilder(response: {
  data: {
    created_at: string;
    created_by: string;
    dev_eui: string;
    id: number;
    include_in_report: boolean;
    note: string | null;
    title: string;
  } | null;
  error: { message: string } | null;
}) {
  const single = jest.fn().mockResolvedValue(response);
  const select = jest.fn().mockReturnValue({ single });

  return {
    insert: jest.fn().mockReturnValue({ select }),
    select,
    single,
  };
}

describe('AirService', () => {
  let service: AirService;
  let client: { from: jest.Mock };
  let mockSupabaseService: { getClient: jest.Mock };

  beforeEach(() => {
    client = {
      from: jest.fn(),
    };
    mockSupabaseService = {
      getClient: jest.fn(() => client),
    };
    service = new AirService(mockSupabaseService as any, {} as any);
    jest
      .spyOn(service as any, 'assertDeviceAccess')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNote', () => {
    it('resolves millisecond timestamps to the canonical air reading before insert', async () => {
      const dto: CreateAirAnnotationDto = {
        created_at: '2026-03-13T14:30:01.232Z',
        dev_eui: ' 2CF7F1C073800102 ',
        include_in_report: true,
        note: 'stable reading',
        title: 'Shift review',
      };
      const resolvedCreatedAt = '2026-03-13T14:30:01.232544+00:00';
      const exactMatchBuilder = createExactMatchBuilder({
        data: null,
        error: null,
      });
      const resolutionBuilder = createResolutionBuilder({
        data: [{ created_at: resolvedCreatedAt }],
        error: null,
      });
      const insertBuilder = createInsertBuilder({
        data: {
          created_at: resolvedCreatedAt,
          created_by: 'user-123',
          dev_eui: '2CF7F1C073800102',
          id: 1,
          include_in_report: true,
          note: dto.note ?? null,
          title: 'Shift review',
        },
        error: null,
      });
      const airDataBuilders = [exactMatchBuilder, resolutionBuilder];

      client.from.mockImplementation((table: string) => {
        if (table === 'cw_air_data') {
          const builder = airDataBuilders.shift();
          if (!builder) {
            throw new Error(`Unexpected extra air data query for ${table}`);
          }
          return builder;
        }
        if (table === 'cw_air_annotations') {
          return insertBuilder;
        }
        throw new Error(`Unexpected table ${table}`);
      });

      await expect(
        service.createNote(dto, { sub: 'user-123' }),
      ).resolves.toEqual({
        created_at: resolvedCreatedAt,
        created_by: 'user-123',
        dev_eui: '2CF7F1C073800102',
        id: 1,
        include_in_report: true,
        note: 'stable reading',
        title: 'Shift review',
      });

      expect((service as any).assertDeviceAccess).toHaveBeenCalledWith(
        '2CF7F1C073800102',
        { sub: 'user-123' },
      );
      expect(exactMatchBuilder.eq).toHaveBeenNthCalledWith(
        1,
        'dev_eui',
        '2CF7F1C073800102',
      );
      expect(exactMatchBuilder.eq).toHaveBeenNthCalledWith(
        2,
        'created_at',
        '2026-03-13T14:30:01.232Z',
      );
      expect(resolutionBuilder.gte).toHaveBeenCalledWith(
        'created_at',
        '2026-03-13T14:30:01.232Z',
      );
      expect(resolutionBuilder.lt).toHaveBeenCalledWith(
        'created_at',
        '2026-03-13T14:30:01.233Z',
      );
      expect(insertBuilder.insert).toHaveBeenCalledWith({
        created_at: resolvedCreatedAt,
        created_by: 'user-123',
        dev_eui: '2CF7F1C073800102',
        include_in_report: true,
        note: 'stable reading',
        title: 'Shift review',
      });
    });

    it('rejects ambiguous created_at values before inserting a note', async () => {
      const dto: CreateAirAnnotationDto = {
        created_at: '2026-03-13T14:30:01Z',
        dev_eui: '2CF7F1C073800102',
        include_in_report: false,
        note: 'stable reading',
        title: 'Shift review',
      };
      const exactMatchBuilder = createExactMatchBuilder({
        data: null,
        error: null,
      });
      const resolutionBuilder = createResolutionBuilder({
        data: [
          { created_at: '2026-03-13T14:30:01.100000+00:00' },
          { created_at: '2026-03-13T14:30:01.900000+00:00' },
        ],
        error: null,
      });
      const insertBuilder = createInsertBuilder({
        data: null,
        error: null,
      });
      const airDataBuilders = [exactMatchBuilder, resolutionBuilder];

      client.from.mockImplementation((table: string) => {
        if (table === 'cw_air_data') {
          const builder = airDataBuilders.shift();
          if (!builder) {
            throw new Error(`Unexpected extra air data query for ${table}`);
          }
          return builder;
        }
        if (table === 'cw_air_annotations') {
          return insertBuilder;
        }
        throw new Error(`Unexpected table ${table}`);
      });

      await expect(
        service.createNote(dto, { sub: 'user-123' }),
      ).rejects.toThrow(
        new BadRequestException(
          'created_at must identify a single air data reading',
        ),
      );
      expect(insertBuilder.insert).not.toHaveBeenCalled();
    });
  });
});
