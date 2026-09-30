import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OmniRouteProtocol } from '../constants/ai.constants';

export interface OmniRouteConfig {
  baseUrl: string;
  apiKey: string;
  primaryProtocol: OmniRouteProtocol;
  primaryModel: string;
  fallbackProtocol: OmniRouteProtocol | null;
  fallbackModel: string | null;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseProtocol(
  value: string | undefined,
  fallback: OmniRouteProtocol,
): OmniRouteProtocol {
  const protocol = value?.trim().toLowerCase() || fallback;
  if (protocol !== 'anthropic' && protocol !== 'openai') {
    throw new Error('OmniRoute protocol must be anthropic or openai');
  }
  return protocol;
}

@Injectable()
export class AiConfigService {
  constructor(private readonly config: ConfigService) {}

  readiness(): { ready: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!this.config.get<string>('OMNIROUTE_API_KEY')?.trim()) {
      missing.push('OMNIROUTE_API_KEY');
    }
    const model = this.config.get<string>('OMNIROUTE_PRIMARY_MODEL')?.trim();
    if (!model) missing.push('OMNIROUTE_PRIMARY_MODEL');
    if (model?.startsWith('auto/'))
      missing.push('FIXED_OMNIROUTE_PRIMARY_MODEL');
    return { ready: missing.length === 0, missing };
  }

  getOmniRouteConfig(): OmniRouteConfig {
    const readiness = this.readiness();
    if (!readiness.ready) {
      throw new Error(
        `AI configuration is not ready: ${readiness.missing.join(', ')}`,
      );
    }

    const baseUrl = (
      this.config.get<string>('OMNIROUTE_BASE_URL') ??
      'https://tichin-lap.tail615d69.ts.net'
    ).replace(/\/+$/, '');
    const fallbackModel =
      this.config.get<string>('OMNIROUTE_FALLBACK_MODEL')?.trim() || null;

    if (fallbackModel?.startsWith('auto/')) {
      throw new Error(
        'OMNIROUTE_FALLBACK_MODEL must be a fixed model or combo',
      );
    }

    return {
      baseUrl,
      apiKey: this.config.get<string>('OMNIROUTE_API_KEY')!.trim(),
      primaryProtocol: parseProtocol(
        this.config.get<string>('OMNIROUTE_PRIMARY_PROTOCOL'),
        'anthropic',
      ),
      primaryModel: this.config.get<string>('OMNIROUTE_PRIMARY_MODEL')!.trim(),
      fallbackProtocol: fallbackModel
        ? parseProtocol(
            this.config.get<string>('OMNIROUTE_FALLBACK_PROTOCOL'),
            'openai',
          )
        : null,
      fallbackModel,
      requestTimeoutMs: parseInteger(
        this.config.get<string>('OMNIROUTE_REQUEST_TIMEOUT_MS'),
        45_000,
        'OMNIROUTE_REQUEST_TIMEOUT_MS',
        1_000,
        120_000,
      ),
      maxResponseBytes: parseInteger(
        this.config.get<string>('OMNIROUTE_MAX_RESPONSE_BYTES'),
        1_000_000,
        'OMNIROUTE_MAX_RESPONSE_BYTES',
        1_024,
        5_000_000,
      ),
      maxOutputTokens: parseInteger(
        this.config.get<string>('AI_MAX_OUTPUT_TOKENS'),
        4_000,
        'AI_MAX_OUTPUT_TOKENS',
        128,
        16_000,
      ),
    };
  }
}
