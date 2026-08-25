import { NestFactory } from '@nestjs/core';
import {
  SwaggerModule,
  DocumentBuilder,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getCommit } from './utils/gitCommit';
import helmet from 'helmet';
import { join } from 'path';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { AllExceptionsFilter } from './v1/common/filters/all-exceptions.filter';
import { STATUS_CODES } from 'http';
import type { Express, NextFunction, Request, Response } from 'express';

// With `trust proxy` pinned to a single hop (Vercel), Express resolves req.ip to
// the authentic client address (the right-most X-Forwarded-For entry Vercel
// appends), so we no longer hand-parse the spoofable left-most XFF entry.
function getRequesterIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function bootstrap() {
  // rawBody: true keeps req.rawBody (a Buffer) alongside the parsed JSON body so
  // the Stripe webhook route can verify the signature over the unmodified payload.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('NestApplication');
  // The Express adapter's getInstance() is typed `any`; pin it once here.
  const expressApp = app.getHttpAdapter().getInstance() as Express;

  // Vercel puts exactly one proxy hop in front of the function, so trust only
  // that single hop. Express then resolves req.ip to the address Vercel appended
  // (the right-most XFF entry) rather than a client-spoofable left-most one — the
  // rate-limit tracker and request logs both depend on this being authentic.
  expressApp.set('trust proxy', 1);
  app.enableCors();

  // Register Helmet BEFORE the routes and Swagger below, so every response —
  // including the Swagger UI and the /docs-json-* handlers — carries the security
  // headers. (It was previously added after Swagger, leaving those routes bare.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        },
      },
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const endpoint = req.originalUrl || req.url || 'unknown';
    const method = req.method || 'UNKNOWN';
    const requesterIp = getRequesterIp(req);
    let hasLogged = false;

    const logRequest = (result: string) => {
      if (hasLogged) {
        return;
      }

      hasLogged = true;
      logger.log(`${requesterIp} - ${endpoint} - ${method} - ${result}`);
    };

    res.on('finish', () => {
      const statusCode = res.statusCode;
      const statusText = STATUS_CODES[statusCode] ?? 'UNKNOWN';

      logRequest(`${statusCode} ${statusText}`);
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        logRequest('CLIENT_CLOSED_REQUEST');
      }
    });

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const config = new DocumentBuilder()
    .setTitle('CropWatch RESTful API')
    .setDescription(
      `CropWatch API powers authenticated device monitoring, automation, and subscription workflows.

Business scope:
- Monitor field and greenhouse devices with time-series telemetry (air, soil, water, traffic).
- Manage device inventory, online/offline status, and latest sensor values for operations dashboards.
- Configure automation with threshold-based rules and scheduled reports with recipients/alert points.
- Manage subscription billing with Stripe checkout, customer portal, subscription state, and product catalog.

Developer notes:
- URI versioning is enabled (current default routes are under /v1).
- Authentication uses Supabase JWT bearer tokens from POST /v1/auth/login.
- Most endpoints are user-scoped and require Authorization: Bearer <token>.
- Telemetry queries support ISO 8601 start/end filters plus optional IANA timezone formatting.
- Device data endpoints support pagination (skip/take) and latest/full payload variants.
- Swagger includes an x-api-key scheme for deployments that enforce API keys upstream.`,
    )
    .setVersion(`Current Commit: ${getCommit()}`)
    .addTag('CropWatch API')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'apiKey')
    .setLicense(
      'License & Distribution',
      'https://www.cropwatch.io/legal/license',
    )
    .setTermsOfService('https://www.cropwatch.io/legal/terms-of-service')
    .setExternalDoc(
      'GitHub Repository',
      'https://github.com/CropWatchDevelopment/api',
    )
    .setContact(
      'CropWatch Support',
      'https://github.com/CropWatchDevelopment/api/issues',
      'kevin@cropwatch.io',
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);

  const fullDoc = SwaggerModule.createDocument(app, config);
  function filterByPrefix(doc: OpenAPIObject, prefix: string): OpenAPIObject {
    return {
      ...doc,
      paths: Object.fromEntries(
        Object.entries(doc.paths).filter(([path]) => path.startsWith(prefix)),
      ),
    };
  }

  const v1Doc = filterByPrefix(fullDoc, '/v1');
  const v2Doc = filterByPrefix(fullDoc, '/v2');

  // register raw JSON endpoints on the underlying Express instance
  expressApp.get('/docs-json-v1', (_req: Request, res: Response) =>
    res.json(v1Doc),
  );
  expressApp.get('/docs-json-v2', (_req: Request, res: Response) =>
    res.json(v2Doc),
  );

  SwaggerModule.setup('docs', app, documentFactory, {
    explorer: true,
    customSiteTitle: 'API Docs',
    customSwaggerUiPath: join(process.cwd(), 'static', 'docs'),
    customCssUrl: '/cw-swagger.css',
    customJs: '/cw-swagger.js',
    customfavIcon: '/favicon.svg',
    swaggerOptions: {
      persistAuthorization: true,
      urls: [
        { url: '/docs-json-v1', name: 'v1' },
        { url: '/docs-json-v2', name: 'v2' },
      ],
      'urls.primaryName': 'v1',
    },
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
