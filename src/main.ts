import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('CropWatch API')
    .setDescription('API documentation for CropWatch application')
    .setVersion('23.8.1')
    .addTag('CropWatch API')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearerAuth',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'apiKey')
    .setLicense('Terms of Use', 'https://CropWatch.io/legal/terms-of-use')
    .setContact('CropWatch Support', 'https://CropWatch.io/support', 'support@cropwatch.io')
    .setBasePath('v23')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory, {
    customSiteTitle: 'API Docs',
    customSwaggerUiPath: join(process.cwd(), 'static', 'docs'),
    customCssUrl: '/cw-swagger.css',
    customfavIcon: '/favico.svg',
  });
  app.use(helmet());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
