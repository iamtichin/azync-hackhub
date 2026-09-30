import type {
  AiConfigService,
  OmniRouteConfig,
} from '../config/ai-config.service';
import { OmniRouteProvider } from './omniroute.provider';
import type { FetchImplementation } from './omniroute.provider';

const baseConfig: OmniRouteConfig = {
  baseUrl: 'https://gateway.test',
  apiKey: 'secret',
  primaryProtocol: 'anthropic',
  primaryModel: 'azync-analysis-v1',
  fallbackProtocol: null,
  fallbackModel: null,
  requestTimeoutMs: 5_000,
  maxResponseBytes: 10_000,
  maxOutputTokens: 1_000,
};

describe('OmniRouteProvider', () => {
  const request = {
    systemPrompt: 'system',
    userPrompt: 'user',
    jobId: 'job-1',
  };

  it('normalizes an Anthropic response and sends deterministic session headers', async () => {
    let capturedInit: RequestInit | undefined;
    const fetcher: FetchImplementation = jest.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        capturedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model: 'claude-sonnet-4.5',
              content: [{ type: 'text', text: '{"valid":true}' }],
              usage: { input_tokens: 2, output_tokens: 3 },
            }),
            { status: 200, headers: { 'x-correlation-id': 'corr-1' } },
          ),
        );
      },
    );
    const provider = new OmniRouteProvider(
      { getOmniRouteConfig: () => baseConfig } as AiConfigService,
      fetcher,
    );

    const result = await provider.analyze(request);
    expect(result).toMatchObject({
      text: '{"valid":true}',
      protocol: 'anthropic',
      resolvedModel: 'claude-sonnet-4.5',
      gatewayCorrelationId: 'corr-1',
    });
    expect(capturedInit?.headers).toMatchObject({
      'x-session-id': 'job-1',
      'x-omniroute-session-id': 'job-1',
    });
  });

  it('performs only one configured protocol fallback for retryable failures', async () => {
    const fetcher = jest
      .fn<ReturnType<FetchImplementation>, Parameters<FetchImplementation>>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'fallback-model',
            choices: [{ message: { content: '{"valid":true}' } }],
            usage: { prompt_tokens: 2, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
      );
    const provider = new OmniRouteProvider(
      {
        getOmniRouteConfig: () => ({
          ...baseConfig,
          fallbackProtocol: 'openai',
          fallbackModel: 'azync-analysis-fallback-v1',
        }),
      } as AiConfigService,
      fetcher,
    );

    const result = await provider.analyze(request);
    expect(result.protocol).toBe('openai');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('treats gateway HTTP 524 as retryable provider unavailability', async () => {
    const provider = new OmniRouteProvider(
      { getOmniRouteConfig: () => baseConfig } as AiConfigService,
      jest.fn().mockResolvedValue(new Response('{}', { status: 524 })),
    );

    await expect(provider.analyze(request)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'OmniRoute returned HTTP 524',
    });
  });
});
