import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RejectNullBytesPipe } from './common/pipes/reject-null-bytes.pipe';

// Requirement #30 (OWASP API #4 — Unrestricted Resource Consumption): every
// request body this API legitimately needs (Wazuh/Suricata/Sysmon/Syslog/PCAP
// event payloads, incident/action DTOs) is well under this. Disabling Nest's
// automatic body parser lets us set the limit explicitly instead of trusting
// whatever the framework/Express default happens to be.
const MAX_REQUEST_BODY_SIZE = '1mb';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

  // Phase 11: nginx (infra/docker/nginx/nginx.conf) sits in front of this app
  // in every deployed configuration and sets X-Forwarded-For — without this,
  // Express ignores that header entirely and `req.ip` resolves to nginx's
  // own Docker-internal address for every single request. That silently
  // broke two things: ThrottlerGuard's default tracker is literally `req.ip`
  // (see @nestjs/throttler's ThrottlerGuard.getTracker), so the 5-attempts/
  // 60s login throttle was a *global* bucket shared by every real client
  // rather than a per-client one; and every RefreshToken.ipAddress/audit
  // metadata value was nginx's address, not the caller's, destroying its
  // forensic value. Trusting the well-known private/loopback ranges (not a
  // blanket `true`) means nginx's forwarded header is honored, while a
  // caller connecting *directly* to the backend's own published port
  // (bypassing nginx — the documented path apps/employee-desktop uses, see
  // infra/docker/docker-compose.yml) cannot spoof an arbitrary X-Forwarded-For
  // and have it trusted, since its own peer address is not itself private.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(json({ limit: MAX_REQUEST_BODY_SIZE }));
  app.use(urlencoded({ extended: true, limit: MAX_REQUEST_BODY_SIZE }));

  app.use(helmet());
  app.enableCors({
    origin: configService.get<string[]>('cors.origin'),
    credentials: true,
  });

  app.useGlobalPipes(
    new RejectNullBytesPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1');

  // Requirement #30 (OWASP API #9 — Improper Inventory Management): the full
  // API surface (every DTO shape, every route) shouldn't be handed out to an
  // unauthenticated caller in production — SwaggerModule.setup() mounts its
  // own unguarded route, bypassing the app's global auth guards entirely.
  // Dev/CI keep it since that's exactly where it's useful.
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Mirqab API')
      .setDescription('Mirqab Backend API Documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get<number>('port') ?? 3000;
  await app.listen(port);
}

bootstrap();
