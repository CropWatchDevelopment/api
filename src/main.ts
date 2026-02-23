import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getCommit } from './utils/gitCommit';
import helmet from 'helmet';
import { join } from 'path';
import { VersioningType } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const config = new DocumentBuilder()
    .setTitle('CropWatch RESTful API')
    .setDescription('API documentation for CropWatch application')
    .setVersion(getCommit())
    .addTag('CropWatch API')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'apiKey')
    .setLicense('Terms of Use', 'https://CropWatch.io/legal/terms-of-use')
    .setContact(
      'CropWatch Support',
      'https://CropWatch.io/support',
      'support@cropwatch.io',
    )
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);

  const fullDoc = SwaggerModule.createDocument(app, config);
  function filterByPrefix(doc: any, prefix: string) {
    return {
      ...doc,
      paths: Object.fromEntries(
        Object.entries(doc.paths).filter(([path]) => path.startsWith(prefix))
      ),
    };
  }

  const v1Doc = filterByPrefix(fullDoc, '/v1');
  const v2Doc = filterByPrefix(fullDoc, '/v2');

  // register raw JSON endpoints on the underlying Express instance
  const expressApp = app.getHttpAdapter().getInstance() as any;
  expressApp.get('/docs-json-v1', (_req: any, res: any) => res.json(v1Doc));
  expressApp.get('/docs-json-v2', (_req: any, res: any) => res.json(v2Doc));

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
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
