import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap() {
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  if (env.APP_ROLE === 'worker') {
    // Worker: no HTTP server, only the queue consumer (registered in AiJobsService).
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    logger.log('Contenter worker is running');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  logger.log(
    `Contenter API (${env.APP_ROLE}) listening on :${env.PORT} — AI provider: ${env.AI_PROVIDER}, queue: ${env.QUEUE_DRIVER}`,
  );
}

void bootstrap();
