import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { VersioningType } from '@nestjs/common';

async function bootstrap() {
  const version = '1';
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });
  app.setGlobalPrefix(`v${version}`);
  app.enableCors();
  app.enableVersioning({
    type: VersioningType.URI,
  });
  const document = SwaggerModule.createDocument(app, getSwaggerConfig(version));
  SwaggerModule.setup('api', app, document, {
    customCssUrl: '../src/assets/css/swagger-custom.css',
    customfavIcon: 'https://cropwatch.io/favicon.svg',
    customSiteTitle: 'CropWatch API Documentation'
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

function getSwaggerConfig(version: string) {
  const config = new DocumentBuilder()
    .setTitle('CropWatch API')
    .setDescription('API documentation for CropWatch services, offering endpoints for authentication, data management, and monitoring capabilities.')
    .setVersion(`v${version}`)
    .addServer('http://localhost:3000', 'Local Development Server')
    .addServer('https://api.cropwatch.com', 'Production Server')
    .setContact('Kevin Cantrell', 'https://cropwatch.com', 'kevin@cropwatch.com')
    .setExternalDoc('CropWatch Knowledge-Base', 'https://kb.cropwatch.io')
    .setLicense('MIT License', 'https://opensource.org/licenses/MIT')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  return config;
}