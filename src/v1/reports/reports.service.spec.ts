import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RequestReportRegenerationDto } from './dto/request-report-regeneration.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import * as managedDevicesHelper from '../common/managed-devices.helper';

jest.mock('../common/managed-devices.helper', () => ({
  listManagedDevices: jest.fn(),
}));

const DEV_EUI = '2CF7F1C073800102';
const USER = { email: 'user@example.com', isStaff: false, sub: 'user-1' };

function recentPeriod(): { periodEnd: string; periodStart: string } {
  const end = new Date();
  end.setDate(end.getDate() - 7);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { periodEnd: end.toISOString(), periodStart: start.toISOString() };
}

function baseDto(): RequestReportRegenerationDto {
  return {
    devEui: DEV_EUI,
    sourceObjectName: '2026_07_12-2026_07_18.pdf',
    ...recentPeriod(),
  };
}

function createQueueTableMock() {
  const selectMaybeSingle = jest.fn();
  const insertSingle = jest.fn();
  const updateMaybeSingle = jest.fn();

  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: insertSingle }),
    }),
    insertSingle,
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      maybeSingle: selectMaybeSingle,
    }),
    selectMaybeSingle,
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ maybeSingle: updateMaybeSingle }),
        }),
      }),
    }),
    updateMaybeSingle,
  };
}

describe('ReportsService.requestRegeneration', () => {
  let service: ReportsService;
  let queueTable: ReturnType<typeof createQueueTableMock>;
  const listManagedDevices =
    managedDevicesHelper.listManagedDevices as jest.Mock;

  beforeEach(() => {
    queueTable = createQueueTableMock();
    const client = {
      from: jest.fn((table: string) => {
        if (table === 'cw_report_regeneration_queue') return queueTable;
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    const supabaseService = {
      getAdminClient: jest.fn(() => null),
      getClient: jest.fn(() => client),
    } as unknown as SupabaseService;

    service = new ReportsService(
      supabaseService,
      {} as DevicesService,
      {} as LocationsService,
    );

    // findOne is exercised by its own integration paths; here it gates the
    // template and supplies assignments.
    jest.spyOn(service, 'findOne').mockResolvedValue({
      assignments: [{ devEui: DEV_EUI }],
      id: 42,
    } as never);

    listManagedDevices.mockResolvedValue([
      { canManage: true, canView: true, devEui: DEV_EUI },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a pending queue row for a valid request', async () => {
    queueTable.selectMaybeSingle.mockResolvedValue({ data: null, error: null });
    const dto = baseDto();
    const row = {
      dev_eui: DEV_EUI,
      id: 1,
      period_end: dto.periodEnd,
      period_start: dto.periodStart,
      requested_at: '2026-07-25T12:00:00Z',
      requested_by: USER.email,
      source_object_name: dto.sourceObjectName,
      status: 'pending',
      template_id: 42,
      timezone: 'Asia/Tokyo',
    };
    queueTable.insertSingle.mockResolvedValue({ data: row, error: null });

    await expect(service.requestRegeneration(42, dto, USER)).resolves.toEqual({
      devEui: DEV_EUI,
      editCount: 1,
      id: 1,
      periodEnd: dto.periodEnd,
      periodStart: dto.periodStart,
      requestedAt: '2026-07-25T12:00:00Z',
      status: 'pending',
      templateId: 42,
    });
    expect(queueTable.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        dev_eui: DEV_EUI,
        requested_by: USER.email,
        source_object_name: dto.sourceObjectName,
        template_id: 42,
        timezone: 'Asia/Tokyo',
      }),
    );
  });

  it('re-touches an existing pending row instead of inserting a duplicate', async () => {
    const dto = baseDto();
    const existing = {
      dev_eui: DEV_EUI,
      id: 9,
      period_end: dto.periodEnd,
      period_start: dto.periodStart,
      requested_at: '2026-07-25T11:00:00Z',
      requested_by: 'earlier@example.com',
      source_object_name: dto.sourceObjectName,
      status: 'pending',
      template_id: 42,
      timezone: 'Asia/Tokyo',
    };
    queueTable.selectMaybeSingle.mockResolvedValue({
      data: existing,
      error: null,
    });
    queueTable.updateMaybeSingle.mockResolvedValue({
      data: { ...existing, requested_by: USER.email },
      error: null,
    });

    const result = await service.requestRegeneration(42, dto, USER);
    expect(result.id).toBe(9);
    expect(queueTable.insert).not.toHaveBeenCalled();
  });

  it('accumulates editCount onto the pending row across repeated saves', async () => {
    const dto = { ...baseDto(), editCount: 3 };
    const existing = {
      dev_eui: DEV_EUI,
      edit_count: 2,
      id: 9,
      period_end: dto.periodEnd,
      period_start: dto.periodStart,
      requested_at: '2026-07-25T11:00:00Z',
      requested_by: 'earlier@example.com',
      source_object_name: dto.sourceObjectName,
      status: 'pending',
      template_id: 42,
      timezone: 'Asia/Tokyo',
    };
    queueTable.selectMaybeSingle.mockResolvedValue({
      data: existing,
      error: null,
    });
    queueTable.updateMaybeSingle.mockResolvedValue({
      data: { ...existing, edit_count: 5 },
      error: null,
    });

    const result = await service.requestRegeneration(42, dto, USER);
    expect(result.editCount).toBe(5);
    expect(queueTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ edit_count: 5 }),
    );
  });

  it('rejects a device that is not assigned to the template', async () => {
    await expect(
      service.requestRegeneration(
        42,
        { ...baseDto(), devEui: 'FFFFFFFFFFFFFFFF' },
        USER,
      ),
    ).rejects.toThrow(
      new BadRequestException('Device is not assigned to this report template'),
    );
    expect(queueTable.insert).not.toHaveBeenCalled();
  });

  it('rejects when the user cannot manage the device', async () => {
    listManagedDevices.mockResolvedValue([
      { canManage: false, canView: true, devEui: DEV_EUI },
    ]);

    await expect(
      service.requestRegeneration(42, baseDto(), USER),
    ).rejects.toThrow(ForbiddenException);
    expect(queueTable.insert).not.toHaveBeenCalled();
  });

  it('rejects periods past the 23-month retention cutoff', async () => {
    const dto = baseDto();
    const oldEnd = new Date();
    oldEnd.setMonth(oldEnd.getMonth() - 24);
    const oldStart = new Date(oldEnd);
    oldStart.setDate(oldStart.getDate() - 6);
    dto.periodStart = oldStart.toISOString();
    dto.periodEnd = oldEnd.toISOString();

    await expect(service.requestRegeneration(42, dto, USER)).rejects.toThrow(
      /can no longer be regenerated/,
    );
    expect(queueTable.insert).not.toHaveBeenCalled();
  });

  it('rejects a sourceObjectName with path traversal', async () => {
    await expect(
      service.requestRegeneration(
        42,
        { ...baseDto(), sourceObjectName: '../other-device/report.pdf' },
        USER,
      ),
    ).rejects.toThrow(new BadRequestException('Invalid sourceObjectName'));
    expect(queueTable.insert).not.toHaveBeenCalled();
  });

  it('rejects an inverted period', async () => {
    const dto = baseDto();
    [dto.periodStart, dto.periodEnd] = [dto.periodEnd, dto.periodStart];

    await expect(service.requestRegeneration(42, dto, USER)).rejects.toThrow(
      new BadRequestException('periodEnd must be after periodStart'),
    );
    expect(queueTable.insert).not.toHaveBeenCalled();
  });

  it('returns the winning row when the insert loses the unique-index race', async () => {
    const dto = baseDto();
    const winner = {
      dev_eui: DEV_EUI,
      id: 3,
      period_end: dto.periodEnd,
      period_start: dto.periodStart,
      requested_at: '2026-07-25T12:00:01Z',
      requested_by: 'other@example.com',
      source_object_name: dto.sourceObjectName,
      status: 'pending',
      template_id: 42,
      timezone: 'Asia/Tokyo',
    };
    queueTable.selectMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // pre-insert check
      .mockResolvedValueOnce({ data: winner, error: null }); // post-23505 re-select
    queueTable.insertSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value' },
    });

    const result = await service.requestRegeneration(42, dto, USER);
    expect(result.id).toBe(3);
  });
});
