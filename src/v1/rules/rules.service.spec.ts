import { Test, TestingModule } from '@nestjs/testing';
import { RulesService } from './rules.service';
import { SupabaseService } from '../../supabase/supabase.service';

describe('RulesService', () => {
  let service: RulesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: () => null,
            getAdminClient: () => null,
          },
        },
      ],
    }).compile();

    service = module.get<RulesService>(RulesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findAll should return global rule visibility for cropwatch staff', async () => {
    const expectedRules = [{ id: 1, name: 'Global rule' }];
    const query: any = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: expectedRules, error: null }),
    };
    const client = {
      from: jest.fn(() => query),
    };

    const serviceWithClient = new RulesService({
      getClient: jest.fn(() => client),
      getAdminClient: jest.fn(),
    } as unknown as SupabaseService);

    await expect(
      serviceWithClient.findAll(
        { sub: 'staff-1', email: 'staff@cropwatch.io' },
        'Bearer token-1',
      ),
    ).resolves.toEqual(expectedRules);

    expect(query.eq).not.toHaveBeenCalledWith('profile_id', 'staff-1');
  });
});
