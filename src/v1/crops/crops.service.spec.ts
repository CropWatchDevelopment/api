import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { CropsService } from './crops.service';

function listBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(),
  };
  // The first order() chains, the second resolves.
  builder.order.mockReturnValueOnce(builder).mockResolvedValueOnce(result);
  return builder;
}

function singleBuilder(result: { data: unknown; error: unknown }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

function createService(builder: unknown) {
  const from = jest.fn(() => builder);
  const supabaseService = { getClient: jest.fn(() => ({ from })) };
  return {
    service: new CropsService(supabaseService as unknown as SupabaseService),
    from,
  };
}

const cucumber = {
  id: 3,
  code: 'cucumber',
  name_en: 'Cucumber',
  name_ja: 'キュウリ',
  category: 'fruiting_vegetable',
  cultivation: 'both',
  sort_order: 30,
};

describe('CropsService', () => {
  describe('findAll', () => {
    it('lists the active crops in display order', async () => {
      const builder = listBuilder({ data: [cucumber], error: null });
      const { service, from } = createService(builder);

      await expect(service.findAll()).resolves.toEqual([cucumber]);

      expect(from).toHaveBeenCalledWith('cw_crop_types');
      expect(builder.eq).toHaveBeenCalledWith('is_active', true);
      expect(builder.order).toHaveBeenNthCalledWith(1, 'sort_order', {
        ascending: true,
      });
      expect(builder.order).toHaveBeenNthCalledWith(2, 'id', {
        ascending: true,
      });
    });

    it('returns an empty list when there are no crops', async () => {
      const { service } = createService(
        listBuilder({ data: null, error: null }),
      );
      await expect(service.findAll()).resolves.toEqual([]);
    });

    it('turns a database error into a 500', async () => {
      const { service } = createService(
        listBuilder({
          data: null,
          error: { message: 'relation does not exist' },
        }),
      );
      await expect(service.findAll()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('findOne', () => {
    it('returns the crop with its targets, numbers coerced and sorted by metric then period', async () => {
      const builder = singleBuilder({
        data: {
          ...cucumber,
          notes: 'Greenhouse and open field.',
          is_active: true,
          cw_crop_targets: [
            {
              metric: 'soil_moisture',
              period: 'all',
              unit: '%',
              min_value: '12.5',
              optimal_min: 20.8,
              optimal_max: '34.2',
              max_value: null,
              notes: 'Loam.',
              sources: ['https://example.org/a'],
            },
            {
              metric: 'air_temperature',
              period: 'night',
              unit: '°C',
              min_value: 8,
              optimal_min: 10,
              optimal_max: 15,
              max_value: 'n/a',
              notes: null,
              sources: null,
            },
            {
              metric: 'air_temperature',
              period: 'day',
              unit: '°C',
              min_value: 8,
              optimal_min: 23,
              optimal_max: 28,
              max_value: 35,
              notes: 'Daytime.',
              sources: [],
            },
          ],
        },
        error: null,
      });
      const { service } = createService(builder);

      const crop = await service.findOne(3);

      expect(builder.eq).toHaveBeenCalledWith('id', 3);
      expect(crop).toMatchObject({ ...cucumber, is_active: true });
      expect(crop).not.toHaveProperty('cw_crop_targets');
      expect(crop.targets.map((t) => `${t.metric}/${t.period}`)).toEqual([
        'air_temperature/day',
        'air_temperature/night',
        'soil_moisture/all',
      ]);
      expect(crop.targets[2]).toEqual({
        metric: 'soil_moisture',
        period: 'all',
        unit: '%',
        min_value: 12.5,
        optimal_min: 20.8,
        optimal_max: 34.2,
        max_value: null,
        notes: 'Loam.',
        sources: ['https://example.org/a'],
      });
      // An unreadable bound is "no value", missing sources an empty list.
      expect(crop.targets[1]).toMatchObject({ max_value: null, sources: [] });
    });

    it('treats an unknown period as all-day and a crop without targets as an empty list', async () => {
      const { service } = createService(
        singleBuilder({
          data: {
            ...cucumber,
            notes: null,
            is_active: false,
            cw_crop_targets: null,
          },
          error: null,
        }),
      );
      await expect(service.findOne(3)).resolves.toMatchObject({
        is_active: false,
        targets: [],
      });

      const { service: withOddPeriod } = createService(
        singleBuilder({
          data: {
            ...cucumber,
            notes: null,
            is_active: true,
            cw_crop_targets: [
              {
                metric: 'co2',
                period: 'dusk',
                unit: 'ppm',
                min_value: null,
                optimal_min: '',
                optimal_max: 900,
                max_value: null,
                notes: null,
                sources: [],
              },
            ],
          },
          error: null,
        }),
      );
      const crop = await withOddPeriod.findOne(3);
      expect(crop.targets[0]).toMatchObject({
        period: 'all',
        optimal_min: null,
        optimal_max: 900,
      });
    });

    it('is a 404 when the crop does not exist', async () => {
      const { service } = createService(
        singleBuilder({ data: null, error: null }),
      );
      await expect(service.findOne(99)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('turns a database error into a 500', async () => {
      const { service } = createService(
        singleBuilder({ data: null, error: { message: 'boom' } }),
      );
      await expect(service.findOne(3)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });
});
