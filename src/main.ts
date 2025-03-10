import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { VersioningType } from '@nestjs/common';
import * as fs from 'fs';
import * as tls from 'tls';
import { RequestLoggerMiddleware } from './middleware/RequestLogger';

async function bootstrap() {
  const keyPath = process.env.PRIVATE_SSL_KEY_PATH;
  const certPath = process.env.CERTIFICATE_PATH;
  const chainPath = process.env.SSL_CHAIN_PATH; // Optional

  if (!fs.existsSync(keyPath)) {
    console.error(`❌ SSL Key not found: ${keyPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(certPath)) {
    console.error(`❌ SSL Certificate not found: ${certPath}`);
    process.exit(1);
  }

  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    ca: chainPath ? fs.readFileSync(chainPath) : undefined, // Include chain if provided
  };

  const version = '1';
  const app = await NestFactory.create(AppModule, {
    cors: true,
    // httpsOptions,
  });
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true);
  app.setGlobalPrefix(`v${version}`);
  app.enableCors({
    origin: '*', // Allow all origins (change to frontend domain if needed)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
  });
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.use((req, res, next) => new RequestLoggerMiddleware().use(req, res, next));

  const document = SwaggerModule.createDocument(app, getSwaggerConfig(version));
  SwaggerModule.setup('swagger', app, document, {
    customCss: `
      #swagger-ui .topbar {
        background: #125d2b !important;
      }
      .swagger-container {
        background: #ebebeb !important;
      }
      #logo_small_svg__SW_TM-logo-on-dark {
        display: none;
      }
      #swagger-ui .topbar .wrapper .topbar-wrapper {
        display: flex;
      }
      .topbar .topbar-wrapper .link svg {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 200px;
        height: 40px;
        background: url("https://www.cropwatch.io/favicon.svg") no-repeat center / contain;
        text-decoration: none;
        margin: 0 10px;
      }
      .topbar .topbar-wrapper .link::after {
        content: "CropWatch - API";
        font-size: 16px;
        color: #fff;
        white-space: nowrap;
        margin-left: 75px;
      }
    `,
    customfavIcon: 'https://www.cropwatch.io/favicon.svg',
    customSiteTitle: 'CropWatch API Documentation'
  });

  console.log(`Listening on port ${process.env.PORT}`);
  await app.listen(process.env.PORT);

  // --- Diagnostic: Log the certificate details being served ---
  logCertificateDetails('api.cropwatch.io', 443);
}

bootstrap();

function logCertificateDetails(host: string, port: number) {
  const options = {
    host,
    port,
    servername: host,
    rejectUnauthorized: false, // We'll log details even if the cert isn't trusted locally
  };

  const socket = tls.connect(options, () => {
    const cert = socket.getPeerCertificate();
    console.log(`Certificate details for ${host}:${port}:`, cert);
    socket.end();
  });

  socket.on('error', (err) => {
    console.error(`Error during TLS connection for ${host}:${port}:`, err);
  });
}

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
