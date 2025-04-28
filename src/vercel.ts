// Register module aliases at the start of the application
import 'module-alias/register';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express, { Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import * as path from 'path';

// Register path aliases
import moduleAlias from 'module-alias';
moduleAlias.addAliases({
  '@': path.join(__dirname, '../'),
  'src': path.join(__dirname, '../')
});

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