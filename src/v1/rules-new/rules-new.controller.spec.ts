import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SaveRuleTemplateDto } from './dto/save-rule-template.dto';
import { RulesNewController } from './rules-new.controller';
import { RulesNewService } from './rules-new.service';

describe('RulesNewController', () => {
  let controller: RulesNewController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RulesNewController],
      providers: [
        {
          provide: RulesNewService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<RulesNewController>(RulesNewController);
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
