import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('CropWatch API')
    .setDescription('API documentation for CropWatch application')
    .setVersion('23.8.1')
    .addTag('CropWatch API')
    .setLicense('Terms of Use', 'https://CropWatch.io/legal/terms-of-use')
    .setContact('CropWatch Support', 'https://CropWatch.io/support', 'support@cropwatch.io')
    .setBasePath('v23')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
