import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

describe('RulesController', () => {
  let controller: RulesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [
        {
          provide: RulesService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<RulesController>(RulesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getStateForDevices accepts repeated and comma-separated dev_eui params', async () => {
    const getStateForDevices = jest.fn().mockResolvedValue({
      ts: '2026-08-11T00:00:00Z',
      states: [],
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [{ provide: RulesService, useValue: { getStateForDevices } }],
    }).compile();
    const user = { sub: 'user-1', email: 'user@example.com', isStaff: false };

    await module
      .get<RulesController>(RulesController)
      .getStateForDevices(user, ['AA', 'BB,CC', ' DD ', '']);

    expect(getStateForDevices).toHaveBeenCalledWith(user, [
      'AA',
      'BB',
      'CC',
      'DD',
    ]);
  });

  it('getStateForDevices tolerates a missing dev_eui param', async () => {
    const getStateForDevices = jest.fn().mockResolvedValue({
      ts: '2026-08-11T00:00:00Z',
      states: [],
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [{ provide: RulesService, useValue: { getStateForDevices } }],
    }).compile();
    const user = { sub: 'user-1', email: 'user@example.com', isStaff: false };

    await module
      .get<RulesController>(RulesController)
      .getStateForDevices(user, undefined);

    expect(getStateForDevices).toHaveBeenCalledWith(user, []);
  });

  it.each([
    ['start', true],
    ['pause', false],
  ] as const)('%s hands over to setRunning', async (route, running) => {
    const setRunning = jest.fn().mockResolvedValue({ id: 7 });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [{ provide: RulesService, useValue: { setRunning } }],
    }).compile();
    const user = { sub: 'user-1', email: 'user@example.com', isStaff: false };

    await expect(
      module.get<RulesController>(RulesController)[route](7, user),
    ).resolves.toEqual({ id: 7 });
    expect(setRunning).toHaveBeenCalledWith(7, running, user);
  });

  describe('save validation of the status and date fields', () => {
    const pipe = new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    });
    const validate = (extra: Record<string, unknown>) =>
      pipe.transform(
        {
          name: 'Freezer temp',
          devEuis: ['AA'],
          criteria: [
            {
              subject: 'temperature_c',
              operator: '>=',
              triggerValue: -15,
              resetValue: -18,
            },
          ],
          actions: [{ actionType: 2, config: { recipient: 'me@example.com' } }],
          ...extra,
        },
        { type: 'body', metatype: SaveRuleTemplateDto },
      ) as Promise<SaveRuleTemplateDto>;

    it('accepts them, and null to clear', async () => {
      await expect(
        validate({
          isActive: false,
          autoStartAt: '2026-12-01T09:00:00+09:00',
          autoPauseAt: '2026-12-24T00:00:00.000Z',
          onAutoPauseStartTemplateId: 12,
        }),
      ).resolves.toMatchObject({
        isActive: false,
        autoStartAt: '2026-12-01T09:00:00+09:00',
        autoPauseAt: '2026-12-24T00:00:00.000Z',
        onAutoPauseStartTemplateId: 12,
      });
      await expect(
        validate({
          autoStartAt: null,
          autoPauseAt: null,
          onAutoPauseStartTemplateId: null,
        }),
      ).resolves.toMatchObject({ autoStartAt: null, autoPauseAt: null });
    });

    it('leaves a field that was not sent undefined, so the save keeps it', async () => {
      const dto = await validate({});
      expect(dto.isActive).toBeUndefined();
      expect(dto.autoStartAt).toBeUndefined();
      expect(dto.autoPauseAt).toBeUndefined();
      expect(dto.onAutoPauseStartTemplateId).toBeUndefined();
    });

    it.each([
      [{ autoStartAt: 'tomorrow' }],
      [{ autoPauseAt: 1796000000000 }],
      [{ onAutoPauseStartTemplateId: '12' }],
      [{ isActive: 'yes' }],
    ])('refuses %j', async (extra) => {
      await expect(validate(extra)).rejects.toMatchObject({ status: 400 });
    });
  });

  it('accepts action config under whitelist validation', async () => {
    const pipe = new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    });
    const payload = {
      name: 'High temperature',
      devEuis: ['DEV-001'],
      criteria: [
        {
          subject: 'temperature_c',
          operator: '>',
          triggerValue: 30,
          resetValue: 25,
        },
      ],
      actions: [
        {
          actionType: 1,
          config: {
            recipient: 'me@example.com',
          },
        },
      ],
    };

    await expect(
      pipe.transform(payload, {
        metatype: SaveRuleTemplateDto,
        type: 'body',
      }),
    ).resolves.toMatchObject({
      actions: [
        {
          actionType: 1,
          config: {
            recipient: 'me@example.com',
          },
        },
      ],
    });
  });
});
