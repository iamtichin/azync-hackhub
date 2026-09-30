import { Inject, Injectable } from '@nestjs/common';
import { AI_PROVIDER } from '../constants/ai.constants';
import {
  AnalysisError,
  sanitizeErrorMessage,
} from '../orchestrator/analysis-error';
import type {
  AIProvider,
  AIProviderResult,
} from '../providers/ai-provider.interface';
import { APP_GUIDE_SUGGESTIONS } from './app-guide.knowledge';
import {
  APP_GUIDE_SYSTEM_PROMPT,
  buildAppGuidePrompt,
  buildAppGuideRepairPrompt,
} from './app-guide.prompt';
import {
  AppGuideResponseSchema,
  type AppGuideResponse,
} from './app-guide.schema';
import {
  AZYNC_BOT_TOOL_SYSTEM_PROMPT,
  AzyncBotDataService,
  AzyncBotToolSelectionSchema,
  buildAzyncBotToolPrompt,
  type AzyncBotToolSelection,
} from './azync-bot-tools';

@Injectable()
export class AzyncBotService {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AIProvider,
    private readonly dataService: AzyncBotDataService,
  ) {}

  suggestions() {
    return { suggestions: APP_GUIDE_SUGGESTIONS };
  }

  async ask(
    userId: string,
    content: string,
    recentMessages: Array<{ role: 'USER' | 'ASSISTANT'; content: string }> = [],
  ) {
    const conversation = recentMessages.slice(-10);
    const selection = await this.selectTool(userId, content, conversation);
    let liveData: unknown = null;
    if (selection.tool !== 'NONE') {
      try {
        liveData = await this.dataService.execute(userId, selection);
      } catch {
        liveData = { tool: selection.tool, unavailable: true };
      }
    }
    const prompt = buildAppGuidePrompt({
      recentMessages: conversation,
      question: content,
      liveData,
    });

    try {
      const result = await this.callAndValidate(userId, prompt);
      return {
        status: 'completed' as const,
        ...result.response,
      };
    } catch (error) {
      const typed = error instanceof AnalysisError ? error : null;
      return {
        status: 'partial' as const,
        answer: null,
        relatedRoutes: [],
        suggestedQuestions: [...APP_GUIDE_SUGGESTIONS.slice(0, 3)],
        error: {
          code: typed?.code ?? 'PROVIDER_UNAVAILABLE',
          message: sanitizeErrorMessage(error),
          retryable: typed?.retryable ?? true,
        },
      };
    }
  }

  private async selectTool(
    userId: string,
    question: string,
    recentMessages: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>,
  ): Promise<AzyncBotToolSelection> {
    try {
      const result = await this.provider.analyze({
        systemPrompt: AZYNC_BOT_TOOL_SYSTEM_PROMPT,
        userPrompt: buildAzyncBotToolPrompt({ question, recentMessages }),
        jobId: `azync-bot-tool-${userId}`,
        temperature: 0,
        maxOutputTokens: 250,
      });
      const parsed = AzyncBotToolSelectionSchema.safeParse(
        this.parseJson(result.text),
      );
      if (parsed.success) return parsed.data;
    } catch {
      // Tool selection is optional; static product guidance remains available.
    }
    return { tool: 'NONE', hackathonQuery: null };
  }

  private async callAndValidate(
    userId: string,
    prompt: string,
  ): Promise<{ response: AppGuideResponse; result: AIProviderResult }> {
    let result = await this.provider.analyze({
      systemPrompt: APP_GUIDE_SYSTEM_PROMPT,
      userPrompt: prompt,
      jobId: `azync-bot-${userId}`,
      temperature: 0.2,
      maxOutputTokens: 1400,
    });
    let validation = AppGuideResponseSchema.safeParse(
      this.parseJson(result.text),
    );
    if (!validation.success) {
      result = await this.provider.analyze({
        systemPrompt: APP_GUIDE_SYSTEM_PROMPT,
        userPrompt: `${prompt}\n${buildAppGuideRepairPrompt(
          validation.error.issues.map((issue) => issue.message),
          result.text,
        )}`,
        jobId: `azync-bot-${userId}`,
        temperature: 0,
        maxOutputTokens: 1400,
      });
      validation = AppGuideResponseSchema.safeParse(
        this.parseJson(result.text),
      );
    }
    if (!validation.success) {
      throw new AnalysisError(
        'INVALID_AI_OUTPUT',
        'Invalid Azync-Bot response',
        true,
      );
    }
    return { response: validation.data, result };
  }

  private parseJson(text: string): unknown {
    try {
      const trimmed = text.trim();
      const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      return JSON.parse(fenced ? fenced[1].trim() : trimmed);
    } catch {
      return null;
    }
  }
}
