import { BadRequestException } from '@nestjs/common';
import { AirService } from './air.service';
import { CreateAirAnnotationDto } from './dto/create-air-annotation.dto';
import { UpdateAirAnnotationDto } from './dto/update-air-annotation.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { TimezoneFormatterService } from '../common/timezone-formatter.service';

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
    service = new AirService(
      mockSupabaseService as unknown as SupabaseService,
      {} as TimezoneFormatterService,
    );
    jest
      .spyOn(
        service as unknown as { assertDeviceAccess: () => Promise<void> },
        'assertDeviceAccess',
      )
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
      const user = {
        email: 'user-123@example.com',
        isStaff: false,
        sub: 'user-123',
      };
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
          created_by: 'user-123@example.com',
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

      await expect(service.createNote(dto, user)).resolves.toEqual({
        created_at: resolvedCreatedAt,
        created_by: 'user-123@example.com',
        dev_eui: '2CF7F1C073800102',
        id: 1,
        include_in_report: true,
        note: 'stable reading',
        title: 'Shift review',
      });

      expect(
        (service as unknown as { assertDeviceAccess: jest.Mock })
          .assertDeviceAccess,
      ).toHaveBeenCalledWith('2CF7F1C073800102', user);
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
        created_by: 'user-123@example.com',
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

  describe('updateNote', () => {
    const existingNote = {
      created_at: '2026-03-13T14:30:01.232544+00:00',
      created_by: 'owner@example.com',
      dev_eui: '2CF7F1C073800102',
      id: 7,
      include_in_report: true,
      note: 'original note',
      title: 'Original title',
    };

    function createUpdateBuilder(fetchResponse: {
      data: typeof existingNote | null;
      error: { message: string } | null;
    }) {
      const single = jest.fn();
      const updateSelect = jest.fn().mockReturnValue({ single });
      const updateEq = jest.fn().mockReturnValue({ select: updateSelect });
      const update = jest.fn().mockReturnValue({ eq: updateEq });
      const maybeSingle = jest.fn().mockResolvedValue(fetchResponse);
      const fetchEq = jest.fn().mockReturnValue({ maybeSingle });
      const select = jest.fn().mockReturnValue({ eq: fetchEq });

      return { fetchEq, maybeSingle, select, single, update, updateEq };
    }

    it('updates only whitelisted fields, ignoring dev_eui/created_at in the body', async () => {
      const user = { email: 'user@example.com', isStaff: false, sub: 'user-1' };
      const builder = createUpdateBuilder({ data: existingNote, error: null });
      const updatedNote = {
        ...existingNote,
        include_in_report: false,
        note: 'corrected note',
        title: 'New title',
      };
      builder.single.mockResolvedValue({ data: updatedNote, error: null });
      client.from.mockReturnValue(builder);

      const dto = {
        created_at: '2020-01-01T00:00:00Z',
        dev_eui: 'FFFFFFFFFFFFFFFF',
        include_in_report: false,
        note: 'corrected note',
        title: 'New title',
      } as UpdateAirAnnotationDto;

      await expect(service.updateNote(7, dto, user)).resolves.toEqual(
        updatedNote,
      );

      // Access is asserted against the STORED dev_eui, not the body's.
      expect(
        (service as unknown as { assertDeviceAccess: jest.Mock })
          .assertDeviceAccess,
      ).toHaveBeenCalledWith('2CF7F1C073800102', user);
      // The update payload must never contain dev_eui or created_at.
      expect(builder.update).toHaveBeenCalledWith({
        include_in_report: false,
        note: 'corrected note',
        title: 'New title',
      });
      expect(builder.updateEq).toHaveBeenCalledWith('id', 7);
    });

    it('rejects when the note does not exist', async () => {
      const builder = createUpdateBuilder({ data: null, error: null });
      client.from.mockReturnValue(builder);

      await expect(
        service.updateNote(
          999,
          { title: 'x' },
          {
            sub: 'user-1',
          },
        ),
      ).rejects.toThrow(new BadRequestException('Air annotation not found'));
      expect(builder.update).not.toHaveBeenCalled();
    });

    it('rejects an update with no editable fields', async () => {
      const builder = createUpdateBuilder({ data: existingNote, error: null });
      client.from.mockReturnValue(builder);

      await expect(
        service.updateNote(
          7,
          { dev_eui: 'FFFFFFFFFFFFFFFF' },
          { sub: 'user-1' },
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'At least one of title, note, or include_in_report is required',
        ),
      );
      expect(builder.update).not.toHaveBeenCalled();
    });

    it('propagates access denial before updating', async () => {
      const builder = createUpdateBuilder({ data: existingNote, error: null });
      client.from.mockReturnValue(builder);
      (
        service as unknown as { assertDeviceAccess: jest.Mock }
      ).assertDeviceAccess.mockRejectedValue(
        new BadRequestException('Device not found'),
      );

      await expect(
        service.updateNote(
          7,
          { title: 'x' },
          {
            sub: 'intruder',
          },
        ),
      ).rejects.toThrow('Device not found');
      expect(builder.update).not.toHaveBeenCalled();
    });
  });
});
