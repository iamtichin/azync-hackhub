import { Module } from '@nestjs/common';
import { AiQueueModule } from './ai-queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AiConfigService } from './config/ai-config.service';
import { AI_PROVIDER, OMNIROUTE_FETCH } from './constants/ai.constants';
import { DemoEvidenceCollector } from './evidence/demo-evidence.collector';
import { EvidenceService } from './evidence/evidence.service';
import { GitHubEvidenceCollector } from './evidence/github-evidence.collector';
import { SolanaEvidenceCollector } from './evidence/solana-evidence.collector';
import { AiOrchestratorService } from './orchestrator/ai-orchestrator.service';
import {
  type FetchImplementation,
  OmniRouteProvider,
} from './providers/omniroute.provider';
import { AiAnalysisProcessor } from './queue/ai-analysis.processor';
import { AiQueueService } from './queue/ai-queue.service';
import { AnalysisBusinessValidator } from './validation/analysis-business.validator';
import { MetricsTracker } from './utils/metrics-tracker';
import { AiContextService } from './context/ai-context.service';
import { AiChatController } from './chat/ai-chat.controller';
import { AiChatService } from './chat/ai-chat.service';
import { ArtifactMemoryService } from './memory/artifact-memory.service';
import { AiChatEncryptionService } from './crypto/ai-chat-encryption.service';
import { AzyncBotController } from './guide/app-guide.controller';
import { AzyncBotService } from './guide/app-guide.service';
import { AzyncBotDataService } from './guide/azync-bot-tools';

const omniRouteFetch: FetchImplementation = (input, init) =>
  globalThis.fetch(input, init);

@Module({
  imports: [PrismaModule, AiQueueModule],
  controllers: [AiChatController, AzyncBotController],
  providers: [
    AiConfigService,
    GitHubEvidenceCollector,
    SolanaEvidenceCollector,
    DemoEvidenceCollector,
    EvidenceService,
    ArtifactMemoryService,
    AiContextService,
    AiChatEncryptionService,
    AiChatService,
    AzyncBotService,
    AzyncBotDataService,
    AnalysisBusinessValidator,
    OmniRouteProvider,
    { provide: AI_PROVIDER, useExisting: OmniRouteProvider },
    { provide: OMNIROUTE_FETCH, useValue: omniRouteFetch },
    AiQueueService,
    AiOrchestratorService,
    AiAnalysisProcessor,
    MetricsTracker,
  ],
  exports: [
    AiConfigService,
    GitHubEvidenceCollector,
    AI_PROVIDER,
    AiQueueService,
    AiOrchestratorService,
    MetricsTracker,
  ],
})
export class AiModule {}
