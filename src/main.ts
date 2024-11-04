import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const version = '1';
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });
  app.setGlobalPrefix(`v${version}`);
  // app.use(helmet());
  app.enableCors();
  // app.useGlobalPipes(new ValidationPipe());
  app.enableVersioning({
    type: VersioningType.URI,
  });

  const config = new DocumentBuilder()
    .setTitle('CropWatch API')
    .setDescription('API documentation for CropWatch services, offering endpoints for authentication, data management, and monitoring capabilities.')
    .setVersion(`v${version}`)
    .addServer('http://localhost:3000', 'Local Development Server')
    .addServer('https://api.cropwatch.com', 'Production Server')
    .setContact('Kevin Cantrell', 'https://cropwatch.com', 'kevin@cropwatch.com')
    .setExternalDoc('CropWatch Knowledge-Base', 'https://kb.cropwatch.io')
    .setLicense('MIT License', 'https://opensource.org/licenses/MIT')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'XYZ')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    customCssUrl: 'https://cropwatch.io/swagger-custom.css',
    customfavIcon: 'https://cropwatch.io/favicon.svg',
    customSiteTitle: 'CropWatch API Documentation'
  });


  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
