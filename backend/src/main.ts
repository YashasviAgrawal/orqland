import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.corsOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('Orqland — Order Management API')
    .setDescription(
      'Order & booking lifecycle for products and services: review, preparation, scheduling, delivery assignment, ' +
        'service execution, exceptions, payments and COD settlement. Every order response includes `actions` — the ' +
        'buttons the current user may press — computed by the workflow engine.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));

  await app.listen(config.port);
  Logger.log(`API ready on http://localhost:${config.port}/api/v1 — docs at /api/docs`, 'Bootstrap');
}

void bootstrap();
