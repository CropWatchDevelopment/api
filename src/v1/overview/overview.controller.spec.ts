import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { OverviewQueryDto } from './dto/overview-query.dto';

const user = { sub: 'user-123', email: null, isStaff: false };

// The pipe main.ts installs globally.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (query: Record<string, unknown>) =>
  pipe.transform(query, { type: 'query', metatype: OverviewQueryDto });

describe('OverviewController', () => {
  let controller: OverviewController;
  let overviewService: { getOverview: jest.Mock };

  beforeEach(async () => {
    overviewService = { getOverview: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OverviewController],
      providers: [{ provide: OverviewService, useValue: overviewService }],
    }).compile();

    controller = module.get(OverviewController);
  });

  it('defaults to the last 24 hours', async () => {
    await controller.getOverview(user, {});

    expect(overviewService.getOverview).toHaveBeenCalledWith(user, '24h');
  });

  it('passes the requested range', async () => {
    await controller.getOverview(user, { range: '30d' });

    expect(overviewService.getOverview).toHaveBeenCalledWith(user, '30d');
  });

  it('accepts the three ranges and no range', async () => {
    await expect(validate({})).resolves.toEqual({});
    for (const range of ['24h', '7d', '30d']) {
      await expect(validate({ range })).resolves.toEqual({ range });
    }
  });

  it('rejects other ranges and unknown parameters', async () => {
    await expect(validate({ range: '1y' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(validate({ days: '7' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lets the browser cache it privately, per account', () => {
    const handler = (
      OverviewController.prototype as unknown as Record<string, object>
    ).getOverview;
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as {
      name: string;
      value: string;
    }[];

    expect(headers).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'private, max-age=300' },
        { name: 'Vary', value: 'Authorization' },
      ]),
    );
  });
});
