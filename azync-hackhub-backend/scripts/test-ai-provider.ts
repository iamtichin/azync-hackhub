import type { ConfigService } from '@nestjs/config';
import { AiConfigService } from '../src/modules/ai/config/ai-config.service';
import { OmniRouteProvider } from '../src/modules/ai/providers/omniroute.provider';

async function main(): Promise<void> {
  const configService = {
    get: (key: string) => process.env[key],
  } as ConfigService;
  const provider = new OmniRouteProvider(
    new AiConfigService(configService),
    globalThis.fetch.bind(globalThis),
  );
  const result = await provider.analyze({
    systemPrompt: 'Return only the requested text.',
    userPrompt: 'Reply exactly: OK',
    jobId: `provider-smoke-${Date.now()}`,
    maxOutputTokens: 16,
    temperature: 0,
  });

  console.log(
    JSON.stringify({
      success: result.text.trim().length > 0,
      provider: result.provider,
      protocol: result.protocol,
      requestedModel: result.requestedModel,
      resolvedModel: result.resolvedModel,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      gatewayCorrelationIdPresent: Boolean(result.gatewayCorrelationId),
      responseBodyPrinted: false,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
