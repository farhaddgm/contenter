import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { AccessGuard, AccessModule } from './common/access';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.service';
import { StorageModule } from './infra/storage/file-storage.service';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BrandDocsModule } from './modules/brand-docs/brand-docs.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { ContentsModule } from './modules/contents/contents.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SamplesModule } from './modules/samples/samples.module';
import { GoogleAccessModule } from './modules/google-access/google-access.module';
import { GoogleDriveModule } from './modules/google-drive/google-drive.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TagsModule } from './modules/tags/tags.module';
import { TopicsModule } from './modules/topics/topics.module';
import { UsersModule } from './modules/users/users.module';
import { InteractionInterceptor } from './modules/smart/interaction.interceptor';
import { SmartCoreModule, SmartModule } from './modules/smart/smart.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AccessModule,
    QueueModule,
    StorageModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    AuditModule,
    SmartCoreModule,
    AuthModule,
    SettingsModule,
    AiModule,
    UsersModule,
    GoogleAccessModule,
    GoogleDriveModule,
    BusinessesModule,
    IntegrationsModule,
    TopicsModule,
    SamplesModule,
    ProfilesModule,
    BrandDocsModule,
    IdeasModule,
    ContentsModule,
    CalendarModule,
    SearchModule,
    ReviewsModule,
    NotificationsModule,
    TagsModule,
    CampaignsModule,
    JobsModule,
    DashboardModule,
    SmartModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: InteractionInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
