import type { ConfigService } from '@nestjs/config';
import { AiConfigService } from './ai-config.service';

function service(values: Record<string, string>): AiConfigService {
  return new AiConfigService({
    get: (key: string) => values[key],
  } as ConfigService);
}

describe('AiConfigService', () => {
  it('reports a missing key without exposing a secret', () => {
    expect(
      service({ OMNIROUTE_PRIMARY_MODEL: 'azync-analysis-v1' }).readiness(),
    ).toEqual({
      ready: false,
      missing: ['OMNIROUTE_API_KEY'],
    });
  });

  it('rejects mutable auto routes', () => {
    expect(
      service({
        OMNIROUTE_API_KEY: 'secret',
        OMNIROUTE_PRIMARY_MODEL: 'auto/best',
      }).readiness(),
    ).toEqual({ ready: false, missing: ['FIXED_OMNIROUTE_PRIMARY_MODEL'] });
  });

  it('builds a fixed primary configuration with optional fallback disabled', () => {
    const config = service({
      OMNIROUTE_API_KEY: 'secret',
      OMNIROUTE_PRIMARY_MODEL: 'azync-analysis-v1',
    }).getOmniRouteConfig();
    expect(config.primaryProtocol).toBe('anthropic');
    expect(config.fallbackModel).toBeNull();
    expect(config.requestTimeoutMs).toBe(45_000);
  });
});
