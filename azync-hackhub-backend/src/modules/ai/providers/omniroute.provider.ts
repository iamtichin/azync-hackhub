import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiConfigService } from '../config/ai-config.service';
import {
  OMNIROUTE_FETCH,
  type OmniRouteProtocol,
} from '../constants/ai.constants';
import { AnalysisError } from '../orchestrator/analysis-error';
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
} from './ai-provider.interface';
import { parseOmniRouteResponse } from './omniroute-response-parser';

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AnalysisError(
        'INVALID_AI_OUTPUT',
        'OmniRoute response exceeded size limit',
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function classifyHttpError(status: number): AnalysisError {
  if (status === 401 || status === 403) {
    return new AnalysisError(
      'AUTHENTICATION_FAILED',
      'OmniRoute authentication failed',
    );
  }
  if (status === 429) {
    return new AnalysisError(
      'RATE_LIMITED',
      'OmniRoute rate limit reached',
      true,
    );
  }
  if (status === 408 || (status >= 500 && status <= 599)) {
    return new AnalysisError(
      'PROVIDER_UNAVAILABLE',
      `OmniRoute returned HTTP ${status}`,
      true,
    );
  }
  return new AnalysisError(
    'INVALID_REQUEST',
    `OmniRoute returned HTTP ${status}`,
  );
}

@Injectable()
export class OmniRouteProvider implements AIProvider {
  private readonly logger = new Logger(OmniRouteProvider.name);

  constructor(
    private readonly aiConfig: AiConfigService,
    @Inject(OMNIROUTE_FETCH) private readonly fetcher: FetchImplementation,
  ) {}

  async analyze(request: AIProviderRequest): Promise<AIProviderResult> {
    const config = this.aiConfig.getOmniRouteConfig();
    try {
      return await this.call(
        request,
        config.primaryProtocol,
        request.requestedModel ?? config.primaryModel,
      );
    } catch (error) {
      const canFallback =
        error instanceof AnalysisError &&
        error.retryable &&
        config.fallbackProtocol &&
        config.fallbackModel;
      if (!canFallback) throw error;
      this.logger.warn(
        JSON.stringify({
          event: 'ai_provider_fallback',
          jobId: request.jobId,
          fromProtocol: config.primaryProtocol,
          toProtocol: config.fallbackProtocol,
          errorCode: error.code,
        }),
      );
      return this.call(
        request,
        config.fallbackProtocol!,
        config.fallbackModel!,
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    const config = this.aiConfig.getOmniRouteConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetcher(`${config.baseUrl}/api/health/ping`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async call(
    request: AIProviderRequest,
    protocol: OmniRouteProtocol,
    model: string,
  ): Promise<AIProviderResult> {
    const config = this.aiConfig.getOmniRouteConfig();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs,
    );
    const startedAt = Date.now();
    const endpoint =
      protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    const headers: Record<string, string> = {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'x-session-id': request.jobId,
      'x-omniroute-session-id': request.jobId,
    };
    if (protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';

    const body =
      protocol === 'anthropic'
        ? {
            model,
            system: request.systemPrompt,
            messages: [{ role: 'user', content: request.userPrompt }],
            max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
            temperature: request.temperature ?? 0,
            stream: false,
          }
        : {
            model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt },
            ],
            max_tokens: request.maxOutputTokens ?? config.maxOutputTokens,
            temperature: request.temperature ?? 0,
            stream: false,
          };

    try {
      const response = await this.fetcher(`${config.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw classifyHttpError(response.status);
      const responseBody = await readBoundedBody(
        response,
        config.maxResponseBytes,
      );
      const parsed = parseOmniRouteResponse(responseBody, protocol);

      const result: AIProviderResult = {
        text: parsed.text,
        provider: 'omniroute',
        protocol,
        requestedModel: model,
        resolvedModel: parsed.resolvedModel || model,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        latencyMs: Date.now() - startedAt,
        costUsd: null,
        gatewayCorrelationId: response.headers.get('x-correlation-id'),
        gatewaySessionId: response.headers.get('x-omniroute-session-id'),
        selectedConnectionId: response.headers.get(
          'x-omniroute-selected-connection-id',
        ),
      };
      this.logger.log(
        JSON.stringify({
          event: 'ai_provider_completed',
          jobId: request.jobId,
          protocol,
          requestedModel: model,
          resolvedModel: result.resolvedModel,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          gatewayCorrelationId: result.gatewayCorrelationId,
        }),
      );
      return result;
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AnalysisError(
          'PROVIDER_TIMEOUT',
          'OmniRoute request timed out',
          true,
        );
      }
      throw new AnalysisError(
        'PROVIDER_UNAVAILABLE',
        'OmniRoute request failed',
        true,
        false,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
