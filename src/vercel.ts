// Simple serverless adapter for Vercel
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import serverlessExpress from '@vendia/serverless-express';

let cachedApp: any;

async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
  });
  
  await app.init();
  return app;
}

export async function handler(req: any, res: any): Promise<void> {
  if (!cachedApp) {
    // Create the Nest.js application only once
    const app = await bootstrap();
    cachedApp = serverlessExpress({ app: app.getHttpAdapter().getInstance() });
  }
  
  // Handle the request with the cached app
  return cachedApp(req, res);
}

export default handler;