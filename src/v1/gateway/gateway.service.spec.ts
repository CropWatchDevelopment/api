import { Test, TestingModule } from '@nestjs/testing';
import { GatewayService } from './gateway.service';
import { SupabaseService } from '../../supabase/supabase.service';

describe('GatewayService', () => {
  let service: GatewayService;
  let supabaseService: { getClient: jest.Mock };

  function createGatewayQuery(result: unknown) {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue(result),
      maybeSingle: jest.fn().mockResolvedValue(result),
    };

    const client = {
      from: jest.fn().mockReturnValue(query),
    };

    return { client, query };
  }

  function createFindAllGatewayQueries(
    ownedGatewayResult: unknown,
    gatewayResult: unknown,
  ) {
    const ownedGatewayQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue(ownedGatewayResult),
    };
    const gatewayQuery = {
      select: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue(gatewayResult),
    };

    const client = {
      from: jest
        .fn()
        .mockReturnValueOnce(ownedGatewayQuery)
        .mockReturnValueOnce(gatewayQuery),
    };

    return { client, ownedGatewayQuery, gatewayQuery };
  }

  beforeEach(async () => {
    supabaseService = {
      getClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayService,
        { provide: SupabaseService, useValue: supabaseService },
      ],
    }).compile();

    service = module.get<GatewayService>(GatewayService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('fetches a gateway scoped to the authenticated owner relation', async () => {
    const gateway = {
      id: 11,
      gateway_id: 'gw-001',
      gateway_name: 'North Gateway',
      is_online: true,
      is_public: false,
      created_at: '2026-04-21T00:00:00.000Z',
      updated_at: null,
      cw_gateways_owners: [{ user_id: 'user-123' }],
    };
    const { client, query } = createGatewayQuery({
      data: gateway,
      error: null,
    });
    supabaseService.getClient.mockReturnValue(client);

    await expect(
      service.findOne(' gw-001 ', { sub: 'user-123' }),
    ).resolves.toEqual(gateway);

    expect(supabaseService.getClient).toHaveBeenCalledWith();
    expect(client.from).toHaveBeenCalledWith('cw_gateways');
    expect(query.eq).toHaveBeenCalledWith('gateway_id', 'gw-001');
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it('fetches all gateways scoped to the authenticated owner relation', async () => {
    const gateways = [
      {
        id: 11,
        gateway_id: 'gw-001',
        gateway_name: 'North Gateway',
        is_online: true,
        is_public: false,
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: null,
      },
      {
        id: 12,
        gateway_id: 'gw-002',
        gateway_name: 'South Gateway',
        is_online: false,
        is_public: false,
        created_at: '2026-04-21T00:00:00.000Z',
        updated_at: null,
      },
    ];
    const { client, ownedGatewayQuery, gatewayQuery } =
      createFindAllGatewayQueries(
        {
          data: [{ gateway_id: 11 }, { gateway_id: 12 }],
          error: null,
        },
        {
          data: gateways,
          error: null,
        },
      );
    supabaseService.getClient.mockReturnValue(client);

    await expect(service.findAll({ sub: 'user-123' })).resolves.toEqual(
      gateways,
    );

    expect(supabaseService.getClient).toHaveBeenCalledWith();
    expect(client.from).toHaveBeenNthCalledWith(1, 'cw_gateways_owners');
    expect(ownedGatewayQuery.eq).toHaveBeenCalledWith('user_id', 'user-123');
    expect(client.from).toHaveBeenNthCalledWith(2, 'cw_gateways');
    expect(gatewayQuery.or).toHaveBeenCalledWith(
      'is_public.eq.true,id.in.(11,12)',
    );
    expect(gatewayQuery.order).toHaveBeenCalledWith('gateway_name', {
      ascending: true,
    });
  });
});
