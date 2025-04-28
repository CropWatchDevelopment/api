import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express from 'express';
import { INestApplication } from '@nestjs/common';

const server = express();

let app: INestApplication;

async function bootstrap(): Promise<INestApplication> {
  const adapter = new ExpressAdapter(server);
  const nestApp = await NestFactory.create(AppModule, adapter);
  
  nestApp.enableCors();
  await nestApp.init();
  
  return nestApp;
}

export default async function handler(req, res) {
  if (!app) {
    app = await bootstrap();
    console.log('NestJS app bootstrapped for serverless');
  }
  
  server(req, res);
}