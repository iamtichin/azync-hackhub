import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SolanaModule } from '../solana/solana.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [SolanaModule, AiModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
