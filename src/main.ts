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
    // customCssUrl: 'assets/css/swagger-custom.css',
    customCss: `
      /* 1. Give the top bar a green background (optional) */
      #swagger-ui .topbar {
        background: #125d2b !important;
      }

      .swagger-container {
        background: #ebebeb !important;
      }

      #logo_small_svg__SW_TM-logo-on-dark {
        display: none;
      }

      /* 2. Center the logo + text horizontally in the top bar */
      #swagger-ui .topbar .wrapper .topbar-wrapper {
        display: flex;
      }

      /* 4. Display the .link as an inline-flex container w/ your custom logo */
      .topbar .topbar-wrapper .link svg {
        display: inline-flex;              /* to align logo background + text */
        align-items: center;              /* vertical center between background + text */
        justify-content: center;
        width: 200px;                     /* adjust as needed */
        height: 40px;                     /* adjust as needed */
        background: url("https://www.cropwatch.io/favicon.svg") no-repeat center / contain;
        text-decoration: none;            /* remove link underline, if any */
        margin: 0 10px;                   /* optional side spacing */
      }

      .topbar .topbar-wrapper .link::after {
        content: "CropWatch - API";
        font-size: 16px;           /* adjust text size */
        color: #fff;               /* make it visible on green background */
        white-space: nowrap;       /* keep text on one line */
        margin-left: 75px;         /* spacing between logo and text */
      }
    `,
    customfavIcon: 'https://www.cropwatch.io/favicon.svg',
    customSiteTitle: 'CropWatch API Documentation'
  });
  let port = process.env.PORT ?? 3000;
  console.log(`Listening on port ${port}`);
  await app.listen(port);
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