import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  createRedisConnectionOptions,
  validateRedisEnvironment,
} from './config/redis.config';
import { AiModule } from './modules/ai/ai.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { SolanaModule } from './modules/solana/solana.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TeamsModule } from './modules/teams/teams.module';
import { HackathonsModule } from './modules/hackathons/hackathons.module';
import { GithubModule } from './modules/github/github.module';
import { PlanningModule } from './modules/planning/planning.module';
import { EventsModule } from './events/events.module';
import { AccessModule } from './modules/access/access.module';
import { UserThrottlerGuard } from './common/security/user-throttler.guard';
import { SubmissionValidationModule } from './modules/submission-validation/submission-validation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateRedisEnvironment,
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: createRedisConnectionOptions({
          REDIS_HOST: config.get<string>('REDIS_HOST'),
          REDIS_PORT: config.get<string>('REDIS_PORT'),
          REDIS_PASSWORD: config.get<string>('REDIS_PASSWORD'),
          REDIS_DB: config.get<string>('REDIS_DB'),
        }),
      }),
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default', ttl: 60000, limit: 120,
      },
      {
        name: 'auth', ttl: 60000, limit: 15,
      },
      {
        name: 'mint', ttl: 60000, limit: 5,
      },
      {
        name: 'ai', ttl: 60000, limit: 12,
      },
      {
        name: 'provision', ttl: 60000, limit: 3,
      },
    ]),
    PrismaModule,
    AccessModule,
    EventsModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    HackathonsModule,
    GithubModule,
    PlanningModule,
    AiModule,
    SubmissionsModule,
    SubmissionValidationModule,
    SolanaModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
