import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { RequestReportRegenerationDto } from './dto/request-report-regeneration.dto';
import { SupabaseService } from '../../supabase/supabase.service';
import { DevicesService } from '../devices/devices.service';
import { LocationsService } from '../locations/locations.service';
import { PaymentsService } from '../payments/payments.service';
import { AccessService } from '../common/authz';

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
  let hasReportingEntitlement: jest.Mock;
  let assertDevicesManageable: jest.Mock;
  let listAccessibleDevices: jest.Mock;

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

    hasReportingEntitlement = jest.fn().mockResolvedValue(true);
    assertDevicesManageable = jest.fn().mockResolvedValue(undefined);
    listAccessibleDevices = jest.fn().mockResolvedValue([]);
    service = new ReportsService(
      supabaseService,
      {} as DevicesService,
      {} as LocationsService,
      { hasReportingEntitlement } as unknown as PaymentsService,
      {
        assertDevicesManageable,
        listAccessibleDevices,
      } as unknown as AccessService,
    );

    // findOne is exercised by its own integration paths; here it gates the
    // template and supplies assignments.
    jest.spyOn(service, 'findOne').mockResolvedValue({
      assignments: [{ devEui: DEV_EUI }],
      id: 42,
    } as never);
  });

  it('requestRegeneration rejects with 403 when the user has no reporting entitlement', async () => {
    hasReportingEntitlement.mockResolvedValue(false);

    await expect(
      service.requestRegeneration(42, baseDto(), USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queueTable.insert).not.toHaveBeenCalled();
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
    expect(assertDevicesManageable).toHaveBeenCalledWith(USER, [DEV_EUI]);
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
    assertDevicesManageable.mockRejectedValue(
      new ForbiddenException(
        'You do not have permission to manage one or more selected devices',
      ),
    );

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

describe('ReportsService staff recipients', () => {
  const CUSTOMER = {
    email: 'farmer@example.com',
    isStaff: false,
    sub: 'farmer-1',
  };
  const STAFF = { email: 'kevin@cropwatch.io', isStaff: true, sub: 'staff-1' };

  const recipient = (
    id: number,
    email: string,
    name: string | null = null,
  ) => ({
    id,
    template_id: 42,
    communication_method: 1,
    email,
    name,
    created_at: '2026-10-01T00:00:00Z',
  });
  const recipientRows = [
    recipient(1, 'farmer@example.com', 'Farmer'),
    recipient(2, 'Sayaka@CropWatch.io', 'Sayaka'),
    recipient(3, 'kevin@cropwatch.io'),
  ];

  // Every query in a chain resolves to the table's rows (or its one row for
  // maybeSingle); inserts are recorded on the stub.
  function tableStub(rows: unknown[] = [], row: unknown = null) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'update', 'delete', 'insert']) {
      chain[method] = jest.fn(() => chain);
    }
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: rows, error: null });
    return chain as Record<string, jest.Mock>;
  }

  function serviceFor() {
    const recipients = tableStub(recipientRows);
    const templateRow = {
      id: 42,
      name: 'Weekly',
      description: null,
      data_pull_interval: 30,
      device_type_id: null,
      is_active: true,
      created_at: '2026-10-01T00:00:00Z',
    };
    const tables: Record<string, Record<string, jest.Mock>> = {
      cw_report_templates: tableStub([templateRow], templateRow),
      cw_device_report_assignments: tableStub([
        {
          id: 1,
          template_id: 42,
          dev_eui: DEV_EUI,
          is_active: true,
          created_at: null,
        },
      ]),
      cw_report_template_schedule: tableStub(),
      cw_report_template_recipients: recipients,
      cw_report_template_alert_points: tableStub(),
      cw_report_template_data_processing_schedules: tableStub(),
    };
    const client = {
      from: jest.fn((table: string) => {
        if (tables[table]) return tables[table];
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    const service = new ReportsService(
      { getClient: jest.fn(() => client) } as unknown as SupabaseService,
      {} as DevicesService,
      {} as LocationsService,
      {
        hasReportingEntitlement: jest.fn().mockResolvedValue(true),
      } as unknown as PaymentsService,
      {
        assertDevicesManageable: jest.fn().mockResolvedValue(undefined),
        listAccessibleDevices: jest.fn().mockResolvedValue([
          {
            devEui: DEV_EUI,
            orgId: null,
            name: 'Device',
            permissionLevel: 1,
            canView: true,
            canManage: true,
          },
        ]),
      } as unknown as AccessService,
    );
    return { service, recipients };
  }

  const savePayload = (recipients: { email: string; name?: string }[]) => ({
    name: 'Weekly',
    dataPullInterval: 30,
    devEuis: [DEV_EUI],
    recipients: recipients.map((entry) => ({
      communicationMethod: 1,
      ...entry,
    })),
  });

  it('are hidden from customers', async () => {
    const { service } = serviceFor();

    const report = await service.findOne(42, CUSTOMER);

    expect(report.recipients.map((entry) => entry.email)).toEqual([
      'farmer@example.com',
    ]);
  });

  it('are hidden from the reports list as well', async () => {
    const { service } = serviceFor();

    const [report] = await service.findAll(CUSTOMER);

    expect(report.recipients.map((entry) => entry.email)).toEqual([
      'farmer@example.com',
    ]);
  });

  it('are shown to staff', async () => {
    const { service } = serviceFor();

    const report = await service.findOne(42, STAFF);

    expect(report.recipients.map((entry) => entry.email)).toEqual([
      'farmer@example.com',
      'Sayaka@CropWatch.io',
      'kevin@cropwatch.io',
    ]);
  });

  it('are kept when a customer saves the report', async () => {
    const { service, recipients } = serviceFor();

    // Retyping a staff address does not add it twice.
    await service.update(
      42,
      savePayload([
        { email: 'new@example.com' },
        { email: 'KEVIN@cropwatch.io' },
      ]),
      CUSTOMER,
    );

    expect(recipients.insert).toHaveBeenCalledWith([
      {
        template_id: 42,
        communication_method: 1,
        email: 'new@example.com',
        name: null,
      },
      {
        template_id: 42,
        communication_method: 1,
        email: 'KEVIN@cropwatch.io',
        name: null,
      },
      {
        template_id: 42,
        communication_method: 1,
        email: 'Sayaka@CropWatch.io',
        name: 'Sayaka',
      },
    ]);
  });

  it('are saved as sent when staff save the report', async () => {
    const { service, recipients } = serviceFor();

    await service.update(
      42,
      savePayload([{ email: 'farmer@example.com' }]),
      STAFF,
    );

    expect(recipients.insert).toHaveBeenCalledWith([
      {
        template_id: 42,
        communication_method: 1,
        email: 'farmer@example.com',
        name: null,
      },
    ]);
  });
});
