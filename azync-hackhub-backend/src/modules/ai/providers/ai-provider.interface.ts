import type { OmniRouteProtocol } from '../constants/ai.constants';

export interface AIProviderRequest {
  systemPrompt: string;
  userPrompt: string;
  requestedModel?: string;
  maxOutputTokens?: number;
  temperature?: number;
  jobId: string;
}

export interface AIProviderResult {
  text: string;
  provider: 'omniroute';
  protocol: OmniRouteProtocol;
  requestedModel: string;
  resolvedModel: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number | null;
  gatewayCorrelationId: string | null;
  gatewaySessionId: string | null;
  selectedConnectionId: string | null;
}

export interface AIProvider {
  analyze(request: AIProviderRequest): Promise<AIProviderResult>;
  healthCheck(): Promise<boolean>;
}
