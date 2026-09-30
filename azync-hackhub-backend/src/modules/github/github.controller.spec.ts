import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhooksController } from './github.controller';

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

describe('WebhooksController', () => {
  const secret = 'test-webhook-secret';
  const githubService = { handleWebhook: jest.fn() };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'GITHUB_WEBHOOK_SECRET' ? secret : undefined,
    ),
  };
  const controller = new WebhooksController(
    githubService as any,
    configService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('verifies the exact raw bytes and forwards delivery metadata', async () => {
    const rawBody = Buffer.from(
      '{ "repository": { "full_name": "azync/repo" }, "commits": [] }',
      'utf8',
    );
    const signature = `sha256=${createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    githubService.handleWebhook.mockResolvedValue({ status: 'processed' });

    await expect(
      controller.handleGithubWebhook(
        'push',
        signature,
        'delivery-1',
        'hook-1',
        { rawBody } as any,
        { repository: { full_name: 'azync/repo' }, commits: [] },
      ),
    ).resolves.toEqual({ status: 'processed' });

    expect(githubService.handleWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'push',
        deliveryId: 'delivery-1',
        hookId: 'hook-1',
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it('fails closed when the signature header is missing', async () => {
    await expect(
      controller.handleGithubWebhook(
        'ping',
        '',
        'delivery-2',
        'hook-1',
        { rawBody: Buffer.from('{}') } as any,
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(githubService.handleWebhook).not.toHaveBeenCalled();
  });

  it('rejects a signature calculated from normalized JSON instead of raw bytes', async () => {
    const rawBody = Buffer.from('{ "zen": "hello" }');
    const normalizedSignature = `sha256=${createHmac('sha256', secret)
      .update('{"zen":"hello"}')
      .digest('hex')}`;

    await expect(
      controller.handleGithubWebhook(
        'ping',
        normalizedSignature,
        'delivery-3',
        'hook-1',
        { rawBody } as any,
        { zen: 'hello' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['bad digest', 'sha256=0000000000000000000000000000000000000000000000000000000000000000'],
    ['malformed algorithm', 'sha1=not-a-sha256-digest'],
  ])('rejects a %s signature before invoking ingestion', async (_label, signature) => {
    await expect(controller.handleGithubWebhook(
      'ping', signature, 'delivery-bad', 'hook-1', { rawBody: Buffer.from('{}') } as any, {},
    )).rejects.toBeInstanceOf(UnauthorizedException);
    expect(githubService.handleWebhook).not.toHaveBeenCalled();
  });
});
