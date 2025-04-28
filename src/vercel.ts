import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express, { Request, Response } from 'express';
import { Logger } from '@nestjs/common';

const server = express();

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(server),
  );
  
  app.enableCors();
  await app.init();
  
  return app;
}

let cachedApp: any;

export default async function handler(req: Request, res: Response) {
  if (!cachedApp) {
    cachedApp = await bootstrap();
    Logger.log('NestJS app bootstrapped for serverless');
  }
  
  return server(req, res);
}