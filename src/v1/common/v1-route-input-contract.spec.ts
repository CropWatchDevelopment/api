import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { AirController } from '../air/air.controller';
import { AirService } from '../air/air.service';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt.auth.guard';
import { DevicesController } from '../devices/devices.controller';
import { DevicesService } from '../devices/devices.service';
import { LocationsController } from '../locations/locations.controller';
import { LocationsService } from '../locations/locations.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { PowerController } from '../power/power.controller';
import { PowerService } from '../power/power.service';
import { ReportsController } from '../reports/reports.controller';
import { ReportsService } from '../reports/reports.service';
import { RulesController } from '../rules/rules.controller';
import { RulesService } from '../rules/rules.service';
import { SoilController } from '../soil/soil.controller';
import { SoilService } from '../soil/soil.service';
import { TrafficController } from '../traffic/traffic.controller';
import { TrafficService } from '../traffic/traffic.service';
import { WaterController } from '../water/water.controller';
import { WaterService } from '../water/water.service';

type MockedMethods = Record<string, jest.Mock>;
type ServiceRegistry = Record<string, MockedMethods>;

type SuccessCase = {
  auth?: boolean;
  body?: unknown;
  expectedBody?: unknown;
  expectedCall?: {
    args: unknown[];
    method: string;
    service: keyof ServiceRegistry;
  };
  expectedStatus: number;
  method: 'delete' | 'get' | 'patch' | 'post';
  name: string;
  url: string;
};

type RejectionCase = {
  auth?: boolean;
  body?: unknown;
  expectedMessage?: string | string[];
  expectedStatus: number;
  method: 'delete' | 'get' | 'patch' | 'post';
  name: string;
  url: string;
};

const AUTH_HEADER = 'Bearer test-token';
const MOCK_USER = { email: 'user@example.com', id: 'user-123' };
const ISO_DATETIME_PLACEHOLDER = '<ISO_8601_DATETIME>';
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const;

function createMockedMethods(methodNames: string[]): MockedMethods {
  return Object.fromEntries(
    methodNames.map((methodName) => [methodName, jest.fn()]),
  );
}

function getAllMocks(serviceRegistry: ServiceRegistry): jest.Mock[] {
  return Object.values(serviceRegistry).flatMap((service) =>
    Object.values(service),
  );
}

function resetAllMocks(serviceRegistry: ServiceRegistry) {
  for (const mockFn of getAllMocks(serviceRegistry)) {
    mockFn.mockReset();
    mockFn.mockResolvedValue({ ok: true });
  }
}

function expectNoServiceCalls(serviceRegistry: ServiceRegistry) {
  for (const mockFn of getAllMocks(serviceRegistry)) {
    expect(mockFn).not.toHaveBeenCalled();
  }
}

function compactObject<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, nestedValue]) => [key, sortDeep(nestedValue)]),
    );
  }

  if (typeof value === 'string' && ISO_DATETIME_REGEX.test(value)) {
    return ISO_DATETIME_PLACEHOLDER;
  }

  return value;
}

function extractSchemaRefName(ref: string): string {
  return ref.replace('#/components/schemas/', '');
}

function normalizeSchema(
  schema: unknown,
  referencedSchemaNames: Set<string>,
): unknown {
  if (schema === null || schema === undefined) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeSchema(item, referencedSchemaNames));
  }

  if (typeof schema !== 'object') {
    return sortDeep(schema);
  }

  const schemaRecord = schema as Record<string, unknown>;

  if (typeof schemaRecord.$ref === 'string') {
    referencedSchemaNames.add(extractSchemaRefName(schemaRecord.$ref));
    return { $ref: schemaRecord.$ref };
  }

  const normalized = compactObject({
    additionalProperties:
      typeof schemaRecord.additionalProperties === 'boolean'
        ? schemaRecord.additionalProperties
        : normalizeSchema(
            schemaRecord.additionalProperties,
            referencedSchemaNames,
          ),
    allOf: normalizeSchema(schemaRecord.allOf, referencedSchemaNames),
    anyOf: normalizeSchema(schemaRecord.anyOf, referencedSchemaNames),
    enum: normalizeSchema(schemaRecord.enum, referencedSchemaNames),
    example: normalizeSchema(schemaRecord.example, referencedSchemaNames),
    format: schemaRecord.format,
    items: normalizeSchema(schemaRecord.items, referencedSchemaNames),
    maximum: schemaRecord.maximum,
    maxLength: schemaRecord.maxLength,
    minimum: schemaRecord.minimum,
    minLength: schemaRecord.minLength,
    nullable: schemaRecord.nullable,
    oneOf: normalizeSchema(schemaRecord.oneOf, referencedSchemaNames),
    properties: schemaRecord.properties
      ? Object.fromEntries(
          Object.entries(
            schemaRecord.properties as Record<string, unknown>,
          ).map(([propertyName, propertySchema]) => [
            propertyName,
            normalizeSchema(propertySchema, referencedSchemaNames),
          ]),
        )
      : undefined,
    required: normalizeSchema(schemaRecord.required, referencedSchemaNames),
    type: schemaRecord.type,
  });

  return sortDeep(normalized);
}

function normalizeParameter(
  parameter: unknown,
  referencedSchemaNames: Set<string>,
) {
  const parameterRecord = parameter as Record<string, unknown>;

  if (typeof parameterRecord.$ref === 'string') {
    referencedSchemaNames.add(extractSchemaRefName(parameterRecord.$ref));
    return { $ref: parameterRecord.$ref };
  }

  return sortDeep(
    compactObject({
      in: parameterRecord.in,
      name: parameterRecord.name,
      required: parameterRecord.required === true,
      schema: normalizeSchema(parameterRecord.schema, referencedSchemaNames),
    }),
  );
}

function normalizeRequestBody(
  requestBody: unknown,
  referencedSchemaNames: Set<string>,
) {
  if (!requestBody || typeof requestBody !== 'object') {
    return undefined;
  }

  const requestBodyRecord = requestBody as Record<string, unknown>;

  if (typeof requestBodyRecord.$ref === 'string') {
    referencedSchemaNames.add(extractSchemaRefName(requestBodyRecord.$ref));
    return { $ref: requestBodyRecord.$ref };
  }

  const content = (requestBodyRecord.content ?? {}) as Record<
    string,
    Record<string, unknown>
  >;

  return sortDeep(
    compactObject({
      content: Object.fromEntries(
        Object.keys(content)
          .sort()
          .map((contentType) => [
            contentType,
            compactObject({
              schema: normalizeSchema(
                content[contentType].schema,
                referencedSchemaNames,
              ),
            }),
          ]),
      ),
      required: requestBodyRecord.required === true,
    }),
  );
}

function collectReferencedSchemas(
  document: OpenAPIObject,
  referencedSchemaNames: Set<string>,
) {
  const schemaComponents = document.components?.schemas ?? {};
  const pendingSchemaNames = [...referencedSchemaNames].sort();
  const collectedSchemas: Record<string, unknown> = {};

  for (let index = 0; index < pendingSchemaNames.length; index += 1) {
    const schemaName = pendingSchemaNames[index];
    const schema = schemaComponents[schemaName];

    if (!schema || collectedSchemas[schemaName]) {
      continue;
    }

    collectedSchemas[schemaName] = normalizeSchema(
      schema,
      referencedSchemaNames,
    );

    for (const nextSchemaName of [...referencedSchemaNames].sort()) {
      if (!pendingSchemaNames.includes(nextSchemaName)) {
        pendingSchemaNames.push(nextSchemaName);
      }
    }
  }

  return sortDeep(collectedSchemas);
}

function extractV1InputContract(document: OpenAPIObject) {
  const referencedSchemaNames = new Set<string>();
  const paths = Object.fromEntries(
    Object.keys(document.paths)
      .filter((path) => path.startsWith('/v1/'))
      .sort()
      .map((path) => {
        const pathItem = document.paths[path] ?? {};
        const operations = Object.fromEntries(
          HTTP_METHODS.filter((method) => pathItem[method]).map((method) => {
            const operation = pathItem[method] as Record<string, unknown>;
            const parameters = ((operation.parameters ?? []) as unknown[])
              .map((parameter) =>
                normalizeParameter(parameter, referencedSchemaNames),
              )
              .sort((left, right) => {
                const leftRecord = left as Record<string, string>;
                const rightRecord = right as Record<string, string>;
                return `${leftRecord.in}:${leftRecord.name}`.localeCompare(
                  `${rightRecord.in}:${rightRecord.name}`,
                );
              });
            const requestBody = normalizeRequestBody(
              operation.requestBody,
              referencedSchemaNames,
            );

            return [
              method,
              sortDeep(
                compactObject({
                  parameters: parameters.length > 0 ? parameters : undefined,
                  requestBody,
                }),
              ),
            ];
          }),
        );

        return [path, operations];
      }),
  );

  return sortDeep({
    components: {
      schemas: collectReferencedSchemas(document, referencedSchemaNames),
    },
    paths,
  });
}

describe('V1 Route Input Contracts', () => {
  let app: INestApplication;
  let serviceRegistry: ServiceRegistry;

  beforeAll(async () => {
    serviceRegistry = {
      air: createMockedMethods(['createNote', 'findOne']),
      auth: createMockedMethods(['loginWithPassword']),
      devices: createMockedMethods([
        'findAll',
        'findAllStatus',
        'findAllDeviceGroups',
        'findAllLatestData',
        'findAllDevicesInLocation',
        'findOne',
        'findData',
        'findDataWithinRange',
        'findLatestData',
        'updatePermissionLevel',
        'updateDevice',
      ]),
      locations: createMockedMethods([
        'create',
        'findAll',
        'findAllLocationGroups',
        'findOne',
        'update',
        'createLocationPermission',
        'updateLocationPermission',
        'updateUserPermissionLevel',
        'removeLocationPermission',
      ]),
      payments: createMockedMethods([
        'createCheckoutSession',
        'listSubscriptions',
        'listProducts',
        'getCustomerState',
        'createCustomerPortalSession',
        'revokeSubscription',
      ]),
      power: createMockedMethods(['findOne']),
      reports: createMockedMethods([
        'create',
        'findAll',
        'findAllHistory',
        'downloadReport',
        'findOne',
        'update',
        'remove',
      ]),
      rules: createMockedMethods([
        'create',
        'findAll',
        'findAllTriggered',
        'findTriggeredCount',
        'findOne',
        'update',
        'remove',
      ]),
      soil: createMockedMethods(['findOne']),
      traffic: createMockedMethods(['findOne']),
      water: createMockedMethods(['findOne']),
    };

    const moduleBuilder = Test.createTestingModule({
      controllers: [
        AirController,
        AuthController,
        DevicesController,
        LocationsController,
        PaymentsController,
        PowerController,
        ReportsController,
        RulesController,
        SoilController,
        TrafficController,
        WaterController,
      ],
      providers: [
        { provide: AirService, useValue: serviceRegistry.air },
        { provide: AuthService, useValue: serviceRegistry.auth },
        { provide: DevicesService, useValue: serviceRegistry.devices },
        { provide: LocationsService, useValue: serviceRegistry.locations },
        { provide: PaymentsService, useValue: serviceRegistry.payments },
        { provide: PowerService, useValue: serviceRegistry.power },
        { provide: ReportsService, useValue: serviceRegistry.reports },
        { provide: RulesService, useValue: serviceRegistry.rules },
        { provide: SoilService, useValue: serviceRegistry.soil },
        { provide: TrafficService, useValue: serviceRegistry.traffic },
        { provide: WaterService, useValue: serviceRegistry.water },
      ],
    });

    moduleBuilder.overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: {
        switchToHttp(): { getRequest(): Record<string, unknown> };
      }) {
        const req = context.switchToHttp().getRequest();
        req.user = MOCK_USER;
        return true;
      },
    });

    const moduleRef: TestingModule = await moduleBuilder.compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    app.enableVersioning({
      defaultVersion: '1',
      type: VersioningType.URI,
    });
    await app.init();
  });

  beforeEach(() => {
    resetAllMocks(serviceRegistry);
  });

  afterAll(async () => {
    await app.close();
  });

  it('matches the full v1 request contract snapshot', () => {
    const swaggerDocument = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('v1 contract').build(),
    );

    expect(extractV1InputContract(swaggerDocument)).toMatchSnapshot();
  });

  const successCases: SuccessCase[] = [
    {
      auth: true,
      expectedBody: MOCK_USER,
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/auth preserves the current protected route',
      url: '/v1/auth',
    },
    {
      expectedCall: {
        args: ['user@example.com', 'super-secret'],
        method: 'loginWithPassword',
        service: 'auth',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/auth/login accepts the current login body shape',
      url: '/v1/auth/login',
      body: {
        email: 'user@example.com',
        password: 'super-secret',
        rememberMe: true,
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [
          {
            created_at: '2026-01-01T00:00:00.000Z',
            dev_eui: 'DEV-001',
            note: 'Sensor cleaned',
          },
          MOCK_USER,
        ],
        method: 'createNote',
        service: 'air',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/air/notes validates and forwards the current body',
      url: '/v1/air/notes',
      body: {
        created_at: '2026-01-01T00:00:00.000Z',
        dev_eui: 'DEV-001',
        note: 'Sensor cleaned',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [
          'DEV-001',
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-01-02T00:00:00.000Z'),
          MOCK_USER,
          'America/Chicago',
        ],
        method: 'findOne',
        service: 'air',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/air/:dev_eui preserves start, end, and timezone query inputs',
      url: '/v1/air/DEV-001?start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z&timezone=America%2FChicago',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          MOCK_USER,
          AUTH_HEADER,
          5,
          1000,
          'Field Group',
          'North Node',
          'Greenhouse',
        ],
        method: 'findAll',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices preserves pagination and filter query names',
      url: '/v1/devices?skip=5&take=2000&group=Field%20Group&name=North%20Node&location=Greenhouse',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAllStatus',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/status keeps the current route',
      url: '/v1/devices/status',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAllDeviceGroups',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/groups keeps the current route',
      url: '/v1/devices/groups',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          MOCK_USER,
          7,
          11,
          AUTH_HEADER,
          'Irrigation',
          'West Node',
          'Field 7',
          'North Farm',
        ],
        method: 'findAllLatestData',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/latest-primary-data preserves the current query contract',
      url: '/v1/devices/latest-primary-data?skip=7&take=11&group-by-device-group=Irrigation&name=West%20Node&location=Field%207&locationGroup=North%20Farm',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, 42, AUTH_HEADER],
        method: 'findAllDevicesInLocation',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/location/:location_id preserves numeric location params',
      url: '/v1/devices/location/42',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, 'DEV-001', AUTH_HEADER],
        method: 'findOne',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/:dev_eui preserves the device identifier input',
      url: '/v1/devices/DEV-001',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, 'DEV-001', 3, 9, AUTH_HEADER],
        method: 'findData',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/:dev_eui/data preserves skip and take query inputs',
      url: '/v1/devices/DEV-001/data?skip=3&take=9',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, 'DEV-001', 'user@example.com', 2, AUTH_HEADER],
        method: 'updatePermissionLevel',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/devices/:dev_eui/permission-level preserves the validated update body',
      url: '/v1/devices/DEV-001/permission-level',
      body: {
        dev_eui: 'DEV-001',
        permissionLevel: 2,
        targetUserEmail: 'user@example.com',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [
          MOCK_USER,
          'DEV-001',
          AUTH_HEADER,
          '2026-01-01T00:00:00.000Z',
          '2026-01-02T12:00:00.000Z',
          2,
          8,
        ],
        method: 'findDataWithinRange',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/:dev_eui/data-within-range preserves date range and pagination inputs',
      url: '/v1/devices/DEV-001/data-within-range?start=2026-01-01T00:00:00.000Z&end=2026-01-02T12:00:00.000Z&skip=2&take=8',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, 'DEV-001', AUTH_HEADER],
        method: 'findLatestData',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/:dev_eui/latest-data preserves the route input',
      url: '/v1/devices/DEV-001/latest-data',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, 'DEV-001', AUTH_HEADER, true],
        method: 'findLatestData',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/devices/:dev_eui/latest-primary-data preserves the route input',
      url: '/v1/devices/DEV-001/latest-primary-data',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          MOCK_USER,
          'DEV-001',
          'Renamed Device',
          'Zone A',
          54,
          AUTH_HEADER,
        ],
        method: 'updateDevice',
        service: 'devices',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/devices/:dev_eui preserves the validated update body',
      url: '/v1/devices/DEV-001',
      body: {
        group: 'Zone A',
        location_id: '54',
        name: 'Renamed Device',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [{ name: 'North Field' }, MOCK_USER, AUTH_HEADER],
        method: 'create',
        service: 'locations',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/locations preserves the validated create body',
      url: '/v1/locations',
      body: {
        name: 'North Field',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAll',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/locations preserves the current route',
      url: '/v1/locations',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAllLocationGroups',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/locations/groups preserves the current route',
      url: '/v1/locations/groups',
    },
    {
      auth: true,
      expectedCall: {
        args: [15, MOCK_USER, AUTH_HEADER],
        method: 'findOne',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/locations/:id preserves numeric ids',
      url: '/v1/locations/15',
    },
    {
      auth: true,
      expectedCall: {
        args: [15, { name: 'North Field' }, MOCK_USER, AUTH_HEADER],
        method: 'update',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/locations/:id preserves the current partial update body',
      url: '/v1/locations/15',
      body: {
        name: 'North Field',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [
          15,
          {
            applyToAllDevices: true,
            location_id: 15,
            user_email: 'user@example.com',
          },
          3,
          true,
          MOCK_USER,
          AUTH_HEADER,
        ],
        method: 'createLocationPermission',
        service: 'locations',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/locations/:id/permission preserves validated body and query inputs',
      url: '/v1/locations/15/permission?newUserEmail=user%40example.com&permission_level=3&applyToAllDevices=true',
      body: {
        applyToAllDevices: true,
        location_id: 15,
        user_email: 'user@example.com',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [15, { admin_user_id: 'admin-1' }, true, MOCK_USER, AUTH_HEADER],
        method: 'updateLocationPermission',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/locations/:id/permission preserves body and query inputs',
      url: '/v1/locations/15/permission?applyToAllDevices=true',
      body: {
        admin_user_id: 'admin-1',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [
          15,
          { extra: 'keep-me', permission_level: 3, user_id: 'user-456' },
          true,
          MOCK_USER,
          AUTH_HEADER,
        ],
        method: 'updateUserPermissionLevel',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/locations/:id/permission-level keeps the current untyped body behavior',
      url: '/v1/locations/15/permission-level?applyToAllDevices=true',
      body: {
        extra: 'keep-me',
        permission_level: 3,
        user_id: 'user-456',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [15, 3, MOCK_USER, AUTH_HEADER],
        method: 'removeLocationPermission',
        service: 'locations',
      },
      expectedStatus: 200,
      method: 'delete',
      name: 'DELETE /v1/locations/:id/permission preserves permission_id query input',
      url: '/v1/locations/15/permission?permission_id=3',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          {
            products: ['550e8400-e29b-41d4-a716-446655440000'],
          },
          MOCK_USER,
        ],
        method: 'createCheckoutSession',
        service: 'payments',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/payments/subscriptions/checkout preserves the validated create body',
      url: '/v1/payments/subscriptions/checkout',
      body: {
        products: ['550e8400-e29b-41d4-a716-446655440000'],
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER],
        method: 'listSubscriptions',
        service: 'payments',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/payments/subscriptions preserves the current route',
      url: '/v1/payments/subscriptions',
    },
    {
      auth: true,
      expectedCall: {
        args: [],
        method: 'listProducts',
        service: 'payments',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/payments/products preserves the current route',
      url: '/v1/payments/products',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER],
        method: 'getCustomerState',
        service: 'payments',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/payments/subscriptions/state preserves the current route',
      url: '/v1/payments/subscriptions/state',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          {
            return_url: 'https://app.cropwatch.io/billing',
          },
          MOCK_USER,
        ],
        method: 'createCustomerPortalSession',
        service: 'payments',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/payments/subscriptions/portal preserves the validated portal body',
      url: '/v1/payments/subscriptions/portal',
      body: {
        return_url: 'https://app.cropwatch.io/billing',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: ['sub_123', MOCK_USER],
        method: 'revokeSubscription',
        service: 'payments',
      },
      expectedStatus: 200,
      method: 'delete',
      name: 'DELETE /v1/payments/subscriptions/:id preserves subscription id input',
      url: '/v1/payments/subscriptions/sub_123',
    },
    {
      expectedCall: {
        args: [9],
        method: 'findOne',
        service: 'power',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/power/:id preserves numeric ids',
      url: '/v1/power/9',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          { dev_eui: 'DEV-001', name: 'Weekly Summary' },
          MOCK_USER,
          AUTH_HEADER,
        ],
        method: 'create',
        service: 'reports',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/reports preserves the validated create body',
      url: '/v1/reports',
      body: {
        dev_eui: 'DEV-001',
        name: 'Weekly Summary',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAll',
        service: 'reports',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/reports preserves the current route',
      url: '/v1/reports',
    },
    {
      auth: true,
      expectedCall: {
        args: ['DEV-001', MOCK_USER, AUTH_HEADER],
        method: 'findAllHistory',
        service: 'reports',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/reports/history/:dev_eui preserves the device input',
      url: '/v1/reports/history/DEV-001',
    },
    {
      auth: true,
      expectedCall: {
        args: ['DEV-001', 'rpt-001', MOCK_USER, AUTH_HEADER, 'my-report.pdf'],
        method: 'downloadReport',
        service: 'reports',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/reports/download/:dev_eui/:report_id/:reportName preserves all path params',
      url: '/v1/reports/download/DEV-001/rpt-001/my-report.pdf',
    },
    {
      auth: true,
      expectedCall: {
        args: ['rpt-001', MOCK_USER, AUTH_HEADER],
        method: 'findOne',
        service: 'reports',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/reports/:id preserves report id input',
      url: '/v1/reports/rpt-001',
    },
    {
      auth: true,
      expectedCall: {
        args: ['rpt-001', { name: 'Weekly Summary' }, MOCK_USER, AUTH_HEADER],
        method: 'update',
        service: 'reports',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/reports/:report_id preserves the current partial update body',
      url: '/v1/reports/rpt-001',
      body: {
        name: 'Weekly Summary',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: ['rpt-001', MOCK_USER, AUTH_HEADER],
        method: 'remove',
        service: 'reports',
      },
      expectedStatus: 200,
      method: 'delete',
      name: 'DELETE /v1/reports/:report_id preserves report id input',
      url: '/v1/reports/rpt-001',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          {
            action_recipient: 'user@example.com',
            dev_eui: 'DEV-001',
            name: 'Low Moisture',
            notifier_type: 1,
            ruleGroupId: 'rule-group-1',
          },
          MOCK_USER,
          AUTH_HEADER,
        ],
        method: 'create',
        service: 'rules',
      },
      expectedStatus: 201,
      method: 'post',
      name: 'POST /v1/rules preserves the validated create body',
      url: '/v1/rules',
      body: {
        action_recipient: 'user@example.com',
        dev_eui: 'DEV-001',
        name: 'Low Moisture',
        notifier_type: 1,
        ruleGroupId: 'rule-group-1',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAll',
        service: 'rules',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/rules preserves the current route',
      url: '/v1/rules',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findAllTriggered',
        service: 'rules',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/rules/triggered preserves the current route',
      url: '/v1/rules/triggered',
    },
    {
      auth: true,
      expectedCall: {
        args: [MOCK_USER, AUTH_HEADER],
        method: 'findTriggeredCount',
        service: 'rules',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/rules/triggered/count preserves the current route',
      url: '/v1/rules/triggered/count',
    },
    {
      auth: true,
      expectedCall: {
        args: [12, MOCK_USER, AUTH_HEADER],
        method: 'findOne',
        service: 'rules',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/rules/:id preserves numeric ids',
      url: '/v1/rules/12',
    },
    {
      auth: true,
      expectedCall: {
        args: [12, { name: 'Low Moisture' }, MOCK_USER, AUTH_HEADER],
        method: 'update',
        service: 'rules',
      },
      expectedStatus: 200,
      method: 'patch',
      name: 'PATCH /v1/rules/:id preserves the current partial update body',
      url: '/v1/rules/12',
      body: {
        name: 'Low Moisture',
      },
    },
    {
      auth: true,
      expectedCall: {
        args: [12, MOCK_USER, AUTH_HEADER],
        method: 'remove',
        service: 'rules',
      },
      expectedStatus: 200,
      method: 'delete',
      name: 'DELETE /v1/rules/:id preserves numeric ids',
      url: '/v1/rules/12',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          'DEV-001',
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-01-02T00:00:00.000Z'),
          MOCK_USER,
          'UTC',
        ],
        method: 'findOne',
        service: 'soil',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/soil/:dev_eui preserves start, end, and timezone query inputs',
      url: '/v1/soil/DEV-001?start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z&timezone=UTC',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          'DEV-001',
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-01-02T00:00:00.000Z'),
          MOCK_USER,
          'Asia/Tokyo',
        ],
        method: 'findOne',
        service: 'traffic',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/traffic/:dev_eui preserves start, end, and timezone query inputs',
      url: '/v1/traffic/DEV-001?start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z&timezone=Asia%2FTokyo',
    },
    {
      auth: true,
      expectedCall: {
        args: [
          'DEV-001',
          new Date('2026-01-01T00:00:00.000Z'),
          new Date('2026-01-02T00:00:00.000Z'),
          MOCK_USER,
          'America/Denver',
        ],
        method: 'findOne',
        service: 'water',
      },
      expectedStatus: 200,
      method: 'get',
      name: 'GET /v1/water/:dev_eui preserves start, end, and timezone query inputs',
      url: '/v1/water/DEV-001?start=2026-01-01T00:00:00.000Z&end=2026-01-02T00:00:00.000Z&timezone=America%2FDenver',
    },
  ];

  const rejectionCases: RejectionCase[] = [
    {
      auth: true,
      body: {
        created_at: '2026-01-01T00:00:00.000Z',
        dev_eui: 'DEV-001',
        note: 'Sensor cleaned',
        unexpected: 'boom',
      },
      expectedMessage: ['property unexpected should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/air/notes rejects unknown body properties',
      url: '/v1/air/notes',
    },
    {
      auth: true,
      expectedMessage: 'end must be a valid date/time',
      expectedStatus: 400,
      method: 'get',
      name: 'GET /v1/air/:dev_eui rejects invalid end query values',
      url: '/v1/air/DEV-001?end=not-a-date',
    },
    {
      auth: true,
      expectedMessage: 'dev_eui is required',
      expectedStatus: 400,
      method: 'get',
      name: 'GET /v1/devices/:dev_eui rejects blank device identifiers',
      url: '/v1/devices/%20',
    },
    {
      auth: true,
      expectedStatus: 501,
      method: 'post',
      name: 'POST /v1/devices/:dev_eui remains not implemented',
      url: '/v1/devices/DEV-001',
    },
    {
      auth: true,
      body: {
        dev_eui: 'DEV-001',
        permissionLevel: 2,
        rogue: true,
        targetUserEmail: 'user@example.com',
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'patch',
      name: 'PATCH /v1/devices/:dev_eui/permission-level rejects unknown body properties',
      url: '/v1/devices/DEV-001/permission-level',
    },
    {
      auth: true,
      body: {
        location_id: 54,
        name: 'Renamed Device',
        rogue: true,
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'patch',
      name: 'PATCH /v1/devices/:dev_eui rejects unknown body properties',
      url: '/v1/devices/DEV-001',
    },
    {
      auth: true,
      body: {
        name: 'North Field',
        rogue: true,
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/locations rejects unknown body properties',
      url: '/v1/locations',
    },
    {
      auth: true,
      body: {
        location_id: 15,
        rogue: true,
        user_email: 'user@example.com',
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/locations/:id/permission rejects unknown body properties',
      url: '/v1/locations/15/permission?newUserEmail=user%40example.com&permission_level=3&applyToAllDevices=true',
    },
    {
      auth: true,
      expectedMessage: 'Location ID and Permission ID are required',
      expectedStatus: 400,
      method: 'delete',
      name: 'DELETE /v1/locations/:id/permission requires permission_id',
      url: '/v1/locations/15/permission',
    },
    {
      auth: true,
      body: {
        products: ['550e8400-e29b-41d4-a716-446655440000'],
        rogue: true,
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/payments/subscriptions/checkout rejects unknown body properties',
      url: '/v1/payments/subscriptions/checkout',
    },
    {
      auth: true,
      body: {
        return_url: 'https://app.cropwatch.io/billing',
        rogue: true,
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/payments/subscriptions/portal rejects unknown body properties',
      url: '/v1/payments/subscriptions/portal',
    },
    {
      auth: true,
      body: {
        dev_eui: 'DEV-001',
        name: 'Weekly Summary',
        rogue: true,
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/reports rejects unknown body properties',
      url: '/v1/reports',
    },
    {
      auth: true,
      body: {
        action_recipient: 'user@example.com',
        dev_eui: 'DEV-001',
        name: 'Low Moisture',
        notifier_type: 1,
        rogue: true,
        ruleGroupId: 'rule-group-1',
      },
      expectedMessage: ['property rogue should not exist'],
      expectedStatus: 400,
      method: 'post',
      name: 'POST /v1/rules rejects unknown body properties',
      url: '/v1/rules',
    },
    {
      auth: true,
      expectedMessage: 'end must be a valid date/time',
      expectedStatus: 400,
      method: 'get',
      name: 'GET /v1/soil/:dev_eui rejects invalid end query values',
      url: '/v1/soil/DEV-001?end=not-a-date',
    },
    {
      auth: true,
      expectedMessage: 'start must be before end',
      expectedStatus: 400,
      method: 'get',
      name: 'GET /v1/traffic/:dev_eui rejects inverted date ranges',
      url: '/v1/traffic/DEV-001?start=2026-01-03T00:00:00.000Z&end=2026-01-02T00:00:00.000Z',
    },
    {
      auth: true,
      expectedMessage: 'end must be a valid date/time',
      expectedStatus: 400,
      method: 'get',
      name: 'GET /v1/water/:dev_eui rejects invalid end query values',
      url: '/v1/water/DEV-001?end=not-a-date',
    },
  ];

  it.each(successCases)('$name', async (testCase) => {
    let req = request(app.getHttpServer())[testCase.method](testCase.url);

    if (testCase.auth) {
      req = req.set('Authorization', AUTH_HEADER);
    }

    if (testCase.body !== undefined) {
      req = req.send(testCase.body);
    }

    const response = await req;

    expect(response.status).toBe(testCase.expectedStatus);

    if (testCase.expectedBody !== undefined) {
      expect(response.body).toEqual(testCase.expectedBody);
    }

    if (testCase.expectedCall) {
      const targetMock =
        serviceRegistry[testCase.expectedCall.service][
          testCase.expectedCall.method
        ];

      expect(targetMock).toHaveBeenCalledTimes(1);
      expect(targetMock).toHaveBeenCalledWith(...testCase.expectedCall.args);
    }

    const expectedCallCount = testCase.expectedCall ? 1 : 0;
    const totalCallCount = getAllMocks(serviceRegistry).reduce(
      (count, mockFn) => count + mockFn.mock.calls.length,
      0,
    );

    expect(totalCallCount).toBe(expectedCallCount);
  });

  it.each(rejectionCases)('$name', async (testCase) => {
    let req = request(app.getHttpServer())[testCase.method](testCase.url);

    if (testCase.auth) {
      req = req.set('Authorization', AUTH_HEADER);
    }

    if (testCase.body !== undefined) {
      req = req.send(testCase.body);
    }

    const response = await req;

    expect(response.status).toBe(testCase.expectedStatus);

    if (testCase.expectedMessage !== undefined) {
      if (Array.isArray(testCase.expectedMessage)) {
        expect(response.body.message).toEqual(
          expect.arrayContaining(testCase.expectedMessage),
        );
      } else {
        expect(response.body.message).toBe(testCase.expectedMessage);
      }
    }

    expectNoServiceCalls(serviceRegistry);
  });
});
