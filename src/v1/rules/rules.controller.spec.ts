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
