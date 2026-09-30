import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { ConfigService } from '@nestjs/config';
import { DemoEvidenceCollector } from './demo-evidence.collector';
import { resolveSafePublicUrl } from './safe-url.policy';

jest.mock('./safe-url.policy', () => ({
  resolveSafePublicUrl: jest.fn(),
}));

describe('DemoEvidenceCollector', () => {
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    jest.resetAllMocks();
  });

  it('uses one absolute deadline when a response slowly trickles bytes', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const interval = setInterval(() => response.write('x'), 20);
      response.once('close', () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `http://public.example:${port}/slow`;
    (resolveSafePublicUrl as jest.Mock).mockResolvedValue({
      url: new URL(url),
      // The transport must use this vetted address, while the request keeps
      // public.example as Host/SNI authority.
      addresses: [{ address: '127.0.0.1', family: 4 }],
    });
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'DEMO_PROBE_TIMEOUT_MS') return 75;
        if (key === 'DEMO_PROBE_MAX_BYTES') return 1024;
        return undefined;
      }),
    } as unknown as ConfigService;

    const startedAt = Date.now();
    const result = await new DemoEvidenceCollector(config).collect(url);

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.errorCode).toBe('TIMEOUT');
    // The peer sends a byte every 20ms, so an idle timeout would never fire.
    expect(Date.now() - startedAt).toBeLessThan(220);
  });

  it('destroys a redirect response before probing the next vetted URL', async () => {
    let redirectClosed = false;
    server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/final' });
        const interval = setInterval(() => response.write('redirect body'), 10);
        response.once('close', () => {
          redirectClosed = true;
          clearInterval(interval);
        });
        return;
      }
      response.end('final');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const url = `http://public.example:${port}/redirect`;
    (resolveSafePublicUrl as jest.Mock).mockImplementation(async (raw: string) => ({
      url: new URL(raw),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    }));
    const config = { get: jest.fn().mockReturnValue(500) } as unknown as ConfigService;

    const result = await new DemoEvidenceCollector(config).collect(url);

    expect(result.status).toBe('VERIFIED');
    expect(redirectClosed).toBe(true);
  });
});
