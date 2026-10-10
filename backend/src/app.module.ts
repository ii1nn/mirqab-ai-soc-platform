import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma/prisma.module';
import { AiModule } from './modules/ai/ai.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AuthModule } from './modules/auth/auth.module';
import { DemoDataModule } from './modules/demo/demo-data.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DevicesModule } from './modules/devices/devices.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PoliciesModule } from './modules/policies/policies.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SecurityTestingModule } from './modules/security-testing/security-testing.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { UsersModule } from './modules/users/users.module';
import { WebsocketModule } from './modules/websocket/websocket.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: true },
    }),
    // Requirement #30 (OWASP API #4 — Unrestricted Resource Consumption):
    // a generous org-wide default; auth.controller.ts overrides this with a
    // much tighter limit on login/signup/forgot-password specifically, since
    // those are the endpoints brute-forcing/credential-stuffing/account-
    // enumeration actually target.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    // Global (internally @Global()) — EventEmitter2 is injectable anywhere
    // without importing this module again. Services emit domain events;
    // RealtimeGateway is the only listener, decoupling the AI/Tickets/
    // Policies/AuditLogs services from knowing a WebSocket layer exists.
    EventEmitterModule.forRoot(),
    // Backs WeeklyReportScheduler's @Cron job (requirement #33/#38) — the
    // only scheduled job in the app, and it runs weekly, not daily.
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    AuthModule,
    AiModule,
    AuditLogsModule,
    DemoDataModule,
    DepartmentsModule,
    DevicesModule,
    MonitoringModule,
    NotificationsModule,
    PoliciesModule,
    ReportsModule,
    SecurityTestingModule,
    TicketsModule,
    WebsocketModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
