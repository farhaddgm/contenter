import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.service';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContentsModule } from './modules/contents/contents.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { SamplesModule } from './modules/samples/samples.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TopicsModule } from './modules/topics/topics.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    QueueModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    AuditModule,
    AuthModule,
    SettingsModule,
    AiModule,
    UsersModule,
    TopicsModule,
    SamplesModule,
    ProfilesModule,
    IdeasModule,
    ContentsModule,
    JobsModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
