import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AI_ANALYSIS_QUEUE,
  createAiAnalysisDefaultJobOptions,
} from './ai-queue.constants';

@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: AI_ANALYSIS_QUEUE,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Keep the existing BullMQ prefix unless a deliberately isolated
        // environment, such as E2E, supplies its own namespace.
        prefix: config.get<string>('REDIS_QUEUE_PREFIX')?.trim() || 'bull',
        defaultJobOptions: createAiAnalysisDefaultJobOptions(
          config.get<string>('AI_JOB_ATTEMPTS'),
        ),
      }),
    }),
  ],
  exports: [BullModule],
})
export class AiQueueModule {}
