import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GithubService } from './github.service';

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

describe('GithubService webhook processing', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'BACKEND_URL') return 'https://api.example.com/base/';
      if (key === 'GITHUB_WEBHOOK_SECRET') return 'secret';
      return undefined;
    }),
  };
  const prisma = {
    team: { findUnique: jest.fn() },
    hackathon: { findUnique: jest.fn() },
    gitHubWebhookDelivery: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    gitHubRepository: {
      upsert: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    gitHubWorkflowRun: { create: jest.fn(), updateMany: jest.fn() },
    submission: { findMany: jest.fn() },
    aiContextSession: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const eventsGateway = {
    emitToTeam: jest.fn(),
    emitToPublicHackathon: jest.fn(),
  };
  let service: GithubService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.gitHubWebhookDelivery.create.mockResolvedValue({});
    prisma.gitHubWebhookDelivery.update.mockResolvedValue({});
    prisma.gitHubWebhookDelivery.updateMany.mockResolvedValue({ count: 1 });
    prisma.gitHubRepository.update.mockResolvedValue({});
    prisma.aiContextSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockResolvedValue([{}, { count: 1 }]);
    prisma.gitHubWorkflowRun.updateMany.mockResolvedValue({ count: 0 });
    prisma.gitHubWorkflowRun.create.mockResolvedValue({});
    service = new GithubService(config as any, prisma as any, eventsGateway as any);
  });

  it('marks submission context stale after a registered repository push', async () => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({
      id: 'repo-1',
      teamId: 'team-1',
    });
    prisma.submission.findMany.mockResolvedValue([{ id: 'submission-1' }]);

    const result = await service.handleWebhook({
      event: 'push',
      deliveryId: 'delivery-1',
      hookId: 'hook-1',
      payloadHash: 'hash-1',
      payload: {
        ref: 'refs/heads/main',
        after: 'commit-sha',
        commits: [{ id: 'commit-sha' }],
        repository: { full_name: 'azync/repo' },
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        duplicate: false,
        status: 'processed',
        staleSubmissionCount: 1,
      }),
    );
    expect(prisma.aiContextSession.updateMany).toHaveBeenCalledWith({
      where: {
        submissionId: { in: ['submission-1'] },
        OR: [
          { latestRevision: null },
          { latestRevision: { not: 'commit-sha' } },
        ],
      },
      data: { status: 'STALE' },
    });
    expect(prisma.gitHubWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
    expect(eventsGateway.emitToTeam).toHaveBeenCalledWith(
      'team-1',
      'repository:updated',
      expect.objectContaining({ lastCommitSha: 'commit-sha' }),
    );
  });

  it('ignores a feature-branch push so it cannot replace the tracked main commit', async () => {
    const result = await service.handleWebhook({
      event: 'push', deliveryId: 'feature-branch-push', hookId: 'hook-1', payloadHash: 'feature-hash',
      payload: { repository: { full_name: 'azync/repo' }, ref: 'refs/heads/feature', after: 'b'.repeat(40) },
    });
    expect(result).toEqual(expect.objectContaining({ status: 'ignored', reason: 'non_default_branch' }));
    expect(prisma.gitHubRepository.update).not.toHaveBeenCalled();
    expect(prisma.aiContextSession.updateMany).not.toHaveBeenCalled();
  });

  it('returns the persisted result for an identical duplicate delivery', async () => {
    prisma.gitHubWebhookDelivery.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    prisma.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      payloadHash: 'hash-1',
      status: 'COMPLETED',
      result: { status: 'processed' },
    });

    await expect(
      service.handleWebhook({
        event: 'ping',
        deliveryId: 'delivery-1',
        hookId: null,
        payloadHash: 'hash-1',
        payload: {},
      }),
    ).resolves.toEqual({
      deliveryId: 'delivery-1',
      duplicate: true,
      status: 'completed',
      result: { status: 'processed' },
    });
  });

  it('rejects reuse of a delivery id with different payload bytes', async () => {
    prisma.gitHubWebhookDelivery.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    prisma.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      payloadHash: 'original-hash',
      status: 'COMPLETED',
      result: null,
    });

    await expect(
      service.handleWebhook({
        event: 'ping',
        deliveryId: 'delivery-1',
        hookId: null,
        payloadHash: 'different-hash',
        payload: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reclaims an identical failed delivery for GitHub redelivery', async () => {
    prisma.gitHubWebhookDelivery.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    prisma.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      payloadHash: 'hash-1', status: 'FAILED', result: null,
    });

    await expect(service.handleWebhook({
      event: 'ping', deliveryId: 'delivery-failed', hookId: null, payloadHash: 'hash-1', payload: {},
    })).resolves.toEqual(expect.objectContaining({ duplicate: false, redelivery: true, status: 'accepted' }));
    expect(prisma.gitHubWebhookDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deliveryId: 'delivery-failed', status: 'FAILED' },
      data: expect.objectContaining({ status: 'PROCESSING', errorCode: null }),
    }));
  });

  it('keeps a fresh PROCESSING delivery as a duplicate but atomically reclaims an expired lease', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' });
    prisma.gitHubWebhookDelivery.create.mockRejectedValue(duplicate);
    prisma.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      payloadHash: 'hash-lease', status: 'PROCESSING', result: null,
      processingLeaseUntil: new Date(Date.now() + 60_000), receivedAt: new Date(),
    });
    prisma.gitHubWebhookDelivery.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.handleWebhook({ event: 'ping', deliveryId: 'fresh-processing', hookId: null, payloadHash: 'hash-lease', payload: {} }))
      .resolves.toEqual(expect.objectContaining({ duplicate: true, status: 'processing' }));

    prisma.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      payloadHash: 'hash-lease', status: 'PROCESSING', result: null,
      processingLeaseUntil: new Date(Date.now() - 1), receivedAt: new Date(Date.now() - 600_000),
    });
    prisma.gitHubWebhookDelivery.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.handleWebhook({ event: 'ping', deliveryId: 'stale-processing', hookId: null, payloadHash: 'hash-lease', payload: {} }))
      .resolves.toEqual(expect.objectContaining({ duplicate: false, redelivery: true, status: 'accepted' }));
    expect(prisma.gitHubWebhookDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ deliveryId: 'stale-processing', status: 'PROCESSING' }),
      data: expect.objectContaining({ processingLeaseUntil: expect.any(Date) }),
    }));
  });

  it('binds completed CI data to registered repo, push SHA, run ID, and attempt', async () => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({ id: 'repo-1', teamId: 'team-1' });
    prisma.team.findUnique.mockResolvedValue({ hackathonId: 'hackathon-1' });
    const result = await service.handleWebhook({
      event: 'workflow_run', deliveryId: 'run-delivery', hookId: 'hook-1', payloadHash: 'hash-run',
      payload: {
        action: 'completed', repository: { full_name: 'azync/repo' },
        workflow_run: {
          id: 77, run_attempt: 2, head_sha: 'a'.repeat(40), head_branch: 'main', event: 'push',
          head_repository: { full_name: 'azync/repo' }, status: 'completed', conclusion: 'success',
          run_started_at: '2026-09-15T10:00:00Z', updated_at: '2026-09-15T10:01:00Z',
        },
      },
    });
    expect(result).toEqual(expect.objectContaining({ status: 'processed', runId: '77', runAttempt: 2, testStatus: 'PASSED', coverageStatus: 'UNKNOWN' }));
    expect(prisma.gitHubWorkflowRun.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      repositoryId: 'repo-1', runId: '77', runAttempt: 2, headSha: 'a'.repeat(40), coverageStatus: 'UNKNOWN',
    }) }));
    expect(eventsGateway.emitToPublicHackathon).toHaveBeenCalledWith(
      'hackathon-1',
      'leaderboard:invalidated',
      { source: 'ci', updatedAt: '2026-09-15T10:01:00.000Z' },
    );
    expect(prisma.gitHubRepository.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastWorkflowRunAt: new Date('2026-09-15T10:01:00Z') }),
    }));
  });

  it.each([
    ['feature branch', 'feature/demo', 'push'],
    ['pull request trigger', 'main', 'pull_request'],
  ])('rejects a workflow run from an unsafe %s', async (_label, headBranch, triggerEvent) => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({ id: 'repo-1', teamId: 'team-1' });
    await expect(service.handleWebhook({
      event: 'workflow_run', deliveryId: `unsafe-${headBranch}`, hookId: null, payloadHash: `hash-${headBranch}`,
      payload: { action: 'completed', repository: { full_name: 'azync/repo' }, workflow_run: {
        id: 79, run_attempt: 1, head_sha: 'd'.repeat(40), head_branch: headBranch, event: triggerEvent,
        head_repository: { full_name: 'azync/repo' }, status: 'completed', conclusion: 'success', updated_at: '2026-09-15T11:00:00Z',
      } },
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists an in-progress run but keeps test and coverage outcomes unknown', async () => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({ id: 'repo-1', teamId: 'team-1' });
    await expect(service.handleWebhook({
      event: 'workflow_run', deliveryId: 'running-run', hookId: null, payloadHash: 'hash-running',
      payload: { action: 'in_progress', repository: { full_name: 'azync/repo' }, workflow_run: {
        id: 80, run_attempt: 1, head_sha: 'e'.repeat(40), head_branch: 'main', event: 'push',
        head_repository: { full_name: 'azync/repo' }, status: 'in_progress', conclusion: null, updated_at: '2026-09-15T12:00:00Z',
      } },
    })).resolves.toEqual(expect.objectContaining({ status: 'processed', testStatus: 'UNKNOWN', coverageStatus: 'UNKNOWN' }));
    expect(prisma.gitHubWorkflowRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completedAt: null, testStatus: 'UNKNOWN' }),
    }));
  });

  it('orders repository CI summary by GitHub event time, not later webhook receipt time', async () => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({ id: 'repo-1', teamId: 'team-1' });
    const workflowPayload = (id: number, updatedAt: string) => ({
      action: 'completed', repository: { full_name: 'azync/repo' }, workflow_run: {
        id, run_attempt: 1, head_sha: `${id.toString(16).padStart(2, '0')}${'f'.repeat(38)}`,
        head_branch: 'main', event: 'push', head_repository: { full_name: 'azync/repo' },
        status: 'completed', conclusion: 'success', updated_at: updatedAt,
      },
    });
    await service.handleWebhook({
      event: 'workflow_run', deliveryId: 'ordered-old', hookId: null, payloadHash: 'ordered-old-hash',
      payload: workflowPayload(81, '2026-09-15T12:00:00Z'),
    });
    await service.handleWebhook({
      event: 'workflow_run', deliveryId: 'ordered-new', hookId: null, payloadHash: 'ordered-new-hash',
      payload: workflowPayload(82, '2026-09-15T12:05:00Z'),
    });
    expect(prisma.gitHubRepository.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'repo-1' }),
      data: expect.objectContaining({ lastWorkflowRunAt: new Date('2026-09-15T12:05:00Z') }),
    }));
  });

  it('does not let an older workflow delivery overwrite a newer run attempt', async () => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({ id: 'repo-1', teamId: 'team-1' });
    prisma.gitHubWorkflowRun.updateMany.mockResolvedValue({ count: 0 });
    prisma.gitHubWorkflowRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
    );
    await expect(service.handleWebhook({
      event: 'workflow_run', deliveryId: 'old-run', hookId: null, payloadHash: 'hash-old',
      payload: { action: 'completed', repository: { full_name: 'azync/repo' }, workflow_run: {
        id: 77, run_attempt: 2, head_sha: 'b'.repeat(40), head_branch: 'main', event: 'push',
        head_repository: { full_name: 'azync/repo' }, status: 'completed', conclusion: 'failure', updated_at: '2026-09-15T09:00:00Z',
      } },
    })).resolves.toEqual(expect.objectContaining({ status: 'ignored', reason: 'out_of_order_run' }));
    expect(prisma.gitHubRepository.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastWorkflowStatus: 'completed' }) }));
  });

  it('records a failed completed CI run as failed while leaving coverage explicitly unknown', async () => {
    prisma.gitHubRepository.findFirst.mockResolvedValue({ id: 'repo-1', teamId: 'team-1' });
    const result = await service.handleWebhook({
      event: 'workflow_run', deliveryId: 'failed-run', hookId: null, payloadHash: 'hash-failed',
      payload: { action: 'completed', repository: { full_name: 'azync/repo' }, workflow_run: {
        id: 78, run_attempt: 1, head_sha: 'c'.repeat(40), head_branch: 'main', event: 'push',
        head_repository: { full_name: 'azync/repo' }, status: 'completed', conclusion: 'failure', updated_at: '2026-09-15T11:00:00Z',
      } },
    });
    expect(result).toEqual(expect.objectContaining({ status: 'processed', testStatus: 'FAILED', coverageStatus: 'UNKNOWN' }));
  });

  it('preserves a configured base path in the public callback URL', () => {
    expect((service as any).buildPublicWebhookUrl()).toBe(
      'https://api.example.com/base/webhooks/github',
    );
  });

  it('updates the matching webhook when it already exists', async () => {
    const listWebhooks = jest.fn().mockResolvedValue({
      data: [
        {
          id: 42,
          config: { url: 'https://api.example.com/base/webhooks/github' },
        },
      ],
    });
    const updateWebhook = jest.fn().mockResolvedValue({});
    const createWebhook = jest.fn();
    (service as any).octokit = {
      repos: { listWebhooks, updateWebhook, createWebhook },
    };

    await (service as any).setupWebhook('repository');

    expect(updateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'azync-hackhub-contests',
        repo: 'repository',
        hook_id: 42,
        active: true,
      }),
    );
    expect(createWebhook).not.toHaveBeenCalled();
  });

  it('provisions one private deterministic repository with required files and minimal access', async () => {
    const createInOrg = jest.fn().mockResolvedValue({ data: {
      full_name: 'azync-hackhub-contests/team-team-123-builders',
      private: true,
      html_url: 'https://github.com/azync-hackhub-contests/team-team-123-builders',
      clone_url: 'https://github.com/azync-hackhub-contests/team-team-123-builders.git',
      ssh_url: 'git@github.com:azync-hackhub-contests/team-team-123-builders.git',
    } });
    const contentsSequence: string[] = [];
    const getContent = jest.fn().mockImplementation(() => {
      contentsSequence.push('read');
      return Promise.reject({ status: 404 });
    });
    const createOrUpdateFileContents = jest.fn().mockImplementation(() => {
      contentsSequence.push('write');
      return Promise.resolve({});
    });
    const addCollaborator = jest.fn()
      .mockResolvedValueOnce({ status: 201 })
      .mockRejectedValueOnce(new Error('github_pat_secret-value invitation rejected'));
    const listWebhooks = jest.fn().mockResolvedValue({ data: [] });
    const createWebhook = jest.fn().mockRejectedValue(new Error('github_pat_secret-value webhook rejected'));
    (service as any).octokit = { repos: {
      createInOrg, getContent, createOrUpdateFileContents, addCollaborator,
      replaceAllTopics: jest.fn().mockResolvedValue({}),
      listWebhooks, createWebhook,
    } };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-123', name: 'Builders', hackathonId: 'hack-1', repository: null,
      members: [
        { userId: 'admin-1', role: 'admin', user: { githubUsername: 'admin-user' } },
      ],
    });
    prisma.hackathon.findUnique.mockResolvedValue({ name: 'MVP Hack', judges: [{ user: { githubUsername: 'judge-user' } }] });
    prisma.gitHubRepository.upsert.mockResolvedValue({ id: 'repo-1' });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1', webhookConfigured: true });

    await service.createRepository({ teamId: 'team-123', topics: ['ai'] }, 'admin-1');

    expect(createInOrg).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-team-123-builders', private: true, auto_init: true,
    }));
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(3);
    expect(contentsSequence).toEqual(['read', 'write', 'read', 'write', 'read', 'write']);
    expect(createOrUpdateFileContents.mock.calls.map((call) => call[0].path)).toEqual(
      expect.arrayContaining(['README.md', 'submission.json', '.github/workflows/ci.yml']),
    );
    const ci = createOrUpdateFileContents.mock.calls.find((call) => call[0].path === '.github/workflows/ci.yml')[0];
    const ciContents = Buffer.from(ci.content, 'base64').toString('utf8');
    expect(ciContents).toContain('contents: read');
    expect(ciContents).not.toContain('pull_request_target');
    expect(ciContents).not.toContain('secrets.');
    expect(addCollaborator).toHaveBeenCalledWith(expect.objectContaining({ username: 'admin-user', permission: 'push' }));
    expect(addCollaborator).toHaveBeenCalledWith(expect.objectContaining({ username: 'judge-user', permission: 'pull' }));
    expect(prisma.gitHubRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ isPrivate: true, provisioningStatus: 'PROVISIONING' }),
    }));
    expect(prisma.gitHubRepository.upsert.mock.calls[0][0].create.collaborators).toEqual(
      expect.arrayContaining([expect.objectContaining({ username: 'judge-user', status: 'failed', error: '[REDACTED] invitation rejected' })]),
    );
    expect(prisma.gitHubRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provisioningStatus: 'WEBHOOK_PENDING', provisioningError: '[REDACTED] webhook rejected' }),
    }));
  });

  it('returns a ready repository without replacing participant files on a second start', async () => {
    const createInOrg = jest.fn();
    const createOrUpdateFileContents = jest.fn();
    (service as any).octokit = { repos: { createInOrg, createOrUpdateFileContents } };
    const repository = {
      id: 'repo-1', fullName: 'azync-hackhub-contests/team-team-123-builders',
      url: 'https://github.com/azync-hackhub-contests/team-team-123-builders',
      provisioningStatus: 'READY', webhookConfigured: true,
    };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-123', name: 'Builders', hackathonId: 'hack-1', repository,
      members: [{ userId: 'admin-1', role: 'admin', user: { githubUsername: 'admin-user' } }],
    });
    prisma.hackathon.findUnique.mockResolvedValue({ name: 'MVP Hack', judges: [] });

    await expect(service.createRepository({ teamId: 'team-123' }, 'admin-1'))
      .resolves.toEqual(expect.objectContaining({ repository }));
    expect(createInOrg).not.toHaveBeenCalled();
    expect(createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(prisma.gitHubRepository.upsert).not.toHaveBeenCalled();
  });

  it('keeps existing participant files when recovering a partly provisioned repository', async () => {
    const repo = {
      full_name: 'azync-hackhub-contests/team-team-123-builders', private: true,
      html_url: 'https://github.com/azync-hackhub-contests/team-team-123-builders',
      clone_url: 'https://github.com/azync-hackhub-contests/team-team-123-builders.git',
      ssh_url: 'git@github.com:azync-hackhub-contests/team-team-123-builders.git',
    };
    const getContent = jest.fn().mockImplementation(({ path }) =>
      path === 'submission.json' ? Promise.reject({ status: 404 }) : Promise.resolve({ data: { sha: 'existing-sha' } }));
    const createOrUpdateFileContents = jest.fn().mockResolvedValue({});
    (service as any).octokit = { repos: {
      createInOrg: jest.fn().mockRejectedValue({ status: 422 }),
      get: jest.fn().mockResolvedValue({ data: repo }), getContent, createOrUpdateFileContents,
      addCollaborator: jest.fn().mockResolvedValue({ status: 204 }),
      listWebhooks: jest.fn().mockResolvedValue({ data: [] }),
      createWebhook: jest.fn().mockResolvedValue({}),
    } };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-123', name: 'Builders', hackathonId: 'hack-1', repository: null,
      members: [{ userId: 'admin-1', role: 'admin', user: { githubUsername: 'admin-user' } }],
    });
    prisma.hackathon.findUnique.mockResolvedValue({ name: 'MVP Hack', judges: [] });
    prisma.gitHubRepository.upsert.mockResolvedValue({ id: 'repo-1' });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });

    await service.createRepository({ teamId: 'team-123' }, 'admin-1');
    expect(createOrUpdateFileContents).toHaveBeenCalledTimes(1);
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(expect.objectContaining({ path: 'submission.json' }));
  });

  it('reconciles a concurrently-created repository instead of creating another one', async () => {
    const createInOrg = jest.fn().mockRejectedValue({ status: 422 });
    const get = jest.fn().mockResolvedValue({ data: {
      full_name: 'azync-hackhub-contests/team-team-123-builders', private: true, html_url: 'https://github.com/x',
      clone_url: 'https://github.com/x.git', ssh_url: 'git@github.com:x.git',
    } });
    (service as any).octokit = { repos: {
      createInOrg, get, getContent: jest.fn().mockRejectedValue({ status: 404 }),
      createOrUpdateFileContents: jest.fn(), addCollaborator: jest.fn().mockResolvedValue({ status: 201 }),
      listWebhooks: jest.fn().mockResolvedValue({ data: [] }), createWebhook: jest.fn(),
    } };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-123', name: 'Builders', hackathonId: 'hack-1', repository: null,
      members: [{ userId: 'admin-1', role: 'admin', user: { githubUsername: 'admin-user' } }],
    });
    prisma.hackathon.findUnique.mockResolvedValue({ name: 'MVP Hack', judges: [] });
    prisma.gitHubRepository.upsert.mockResolvedValue({ id: 'repo-1' });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });

    await service.createRepository({ teamId: 'team-123' }, 'admin-1');

    expect(createInOrg).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ owner: 'azync-hackhub-contests', repo: 'team-team-123-builders' });
  });

  it('rejects a recovered public repository instead of recording it as private', async () => {
    (service as any).octokit = { repos: {
      createInOrg: jest.fn().mockRejectedValue({ status: 422 }),
      get: jest.fn().mockResolvedValue({ data: { full_name: 'azync-hackhub-contests/team-team-123-builders', private: false } }),
    } };

    await expect((service as any).createOrFindRepository('team-team-123-builders', 'fixture'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('recovers a database write failure from the same private repository without creating another', async () => {
    const repository = {
      full_name: 'azync-hackhub-contests/team-team-123-builders', private: true,
      html_url: 'https://github.com/azync/team-team-123-builders',
      clone_url: 'https://github.com/azync/team-team-123-builders.git',
      ssh_url: 'git@github.com:azync/team-team-123-builders.git',
    };
    const createInOrg = jest.fn()
      .mockResolvedValueOnce({ data: repository })
      .mockRejectedValueOnce({ status: 422 });
    const get = jest.fn().mockResolvedValue({ data: repository });
    (service as any).octokit = { repos: {
      createInOrg, get,
      getContent: jest.fn().mockRejectedValue({ status: 404 }),
      createOrUpdateFileContents: jest.fn().mockResolvedValue({}),
      addCollaborator: jest.fn().mockResolvedValue({ status: 201 }),
      listWebhooks: jest.fn().mockResolvedValue({ data: [] }),
      createWebhook: jest.fn().mockResolvedValue({}),
    } };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-123', name: 'Builders', hackathonId: 'hack-1', repository: null,
      members: [{ userId: 'admin-1', role: 'admin', user: { githubUsername: 'admin-user' } }],
    });
    prisma.hackathon.findUnique.mockResolvedValue({ name: 'MVP Hack', judges: [] });
    prisma.gitHubRepository.upsert
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ id: 'repo-1' });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });

    await expect(service.createRepository({ teamId: 'team-123' }, 'admin-1'))
      .rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(service.createRepository({ teamId: 'team-123' }, 'admin-1'))
      .resolves.toEqual(expect.objectContaining({ repository: { id: 'repo-1' } }));
    expect(createInOrg).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith({ owner: 'azync-hackhub-contests', repo: 'team-team-123-builders' });
  });

  it('retries a failed stale-collaborator revoke on the next roster sync', async () => {
    const removeCollaborator = jest.fn()
      .mockRejectedValueOnce(new Error('temporary revoke failure'))
      .mockResolvedValueOnce({});
    (service as any).octokit = { repos: { addCollaborator: jest.fn(), removeCollaborator } };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', hackathonId: 'hack-1',
      members: [],
      repository: { fullName: 'azync/team-1', collaborators: [{ username: 'former-user', permission: 'push', status: 'active' }] },
    });
    prisma.hackathon.findUnique.mockResolvedValue({ judges: [] });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });

    await (service as any).syncTeamCollaborators('team-1');
    expect(prisma.gitHubRepository.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ collaborators: [expect.objectContaining({ status: 'revoke_failed' })] }),
    }));
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', hackathonId: 'hack-1', members: [],
      repository: { fullName: 'azync/team-1', collaborators: [{ username: 'former-user', permission: 'push', status: 'revoke_failed' }] },
    });
    await (service as any).syncTeamCollaborators('team-1');
    expect(removeCollaborator).toHaveBeenCalledTimes(2);
    expect(prisma.gitHubRepository.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ collaborators: [expect.objectContaining({ status: 'revoked' })] }),
    }));
  });

  it('durably reports a retryable roster sync when the GitHub provider is unavailable', async () => {
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', repository: { fullName: 'azync/team-1', collaborators: [] }, members: [],
    });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });
    (service as any).octokit = null;

    await expect(service.syncTeamCollaborators('team-1')).resolves.toEqual(
      expect.objectContaining({ status: 'unavailable' }),
    );
    expect(prisma.gitHubRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: 'team-1' },
      data: expect.objectContaining({ provisioningError: expect.stringContaining('sync pending') }),
    }));
  });

  it('lets a team admin reconcile accepted collaborator invitations with GitHub', async () => {
    const addCollaborator = jest.fn().mockResolvedValue({ status: 204 });
    (service as any).octokit = { repos: { addCollaborator, removeCollaborator: jest.fn() } };
    prisma.team.findUnique.mockResolvedValue({
      id: 'team-1', hackathonId: 'hack-1',
      members: [{ userId: 'admin-1', role: 'admin', user: { githubUsername: 'admin-user' } }],
      repository: {
        fullName: 'azync-hackhub-contests/team-1',
        collaborators: [{ username: 'admin-user', permission: 'push', status: 'invited' }],
      },
    });
    prisma.hackathon.findUnique.mockResolvedValue({ judges: [] });
    prisma.gitHubRepository.update.mockResolvedValue({
      id: 'repo-1', provisioningError: null,
      collaborators: [{ username: 'admin-user', permission: 'push', status: 'active' }],
    });

    await expect(service.refreshCollaborators('team-1', 'not-admin'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(addCollaborator).not.toHaveBeenCalled();
    await expect(service.refreshCollaborators('team-1', 'admin-1'))
      .resolves.toEqual(expect.objectContaining({
        status: 'synced', repository: expect.objectContaining({
          collaborators: [expect.objectContaining({ status: 'active' })],
        }),
      }));
    expect(addCollaborator).toHaveBeenCalledWith(expect.objectContaining({
      username: 'admin-user', permission: 'push',
    }));
  });

  it('marks provisioning READY after a successful webhook retry and pending after a failed retry', async () => {
    (service as any).octokit = { repos: {} };
    prisma.team.findUnique.mockResolvedValue({
      members: [{ userId: 'admin-1', role: 'admin' }],
      repository: { fullName: 'azync/team-123' },
    });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });
    const setup = jest.spyOn(service as any, 'setupWebhook').mockResolvedValueOnce(undefined);

    await expect(service.retryWebhook('team-123', 'admin-1')).resolves.toEqual(
      expect.objectContaining({ status: 'configured' }),
    );
    expect(prisma.gitHubRepository.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ provisioningStatus: 'READY', provisioningError: null }),
    }));

    setup.mockRejectedValueOnce(new Error('github_pat_retry-secret denied'));
    await expect(service.retryWebhook('team-123', 'admin-1')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(prisma.gitHubRepository.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provisioningStatus: 'WEBHOOK_PENDING',
        provisioningError: '[REDACTED] denied',
      }),
    }));
  });

  it.each([
    [201, 'invited'],
    [204, 'active'],
  ])('persists a manual collaborator %s outcome as %s', async (httpStatus, status) => {
    const addCollaborator = jest.fn().mockResolvedValue({ status: httpStatus });
    (service as any).octokit = { repos: { addCollaborator } };
    prisma.team.findUnique.mockResolvedValue({
      members: [{ userId: 'admin-1', role: 'admin' }],
      repository: { fullName: 'azync/team-123', collaborators: [{ username: 'old-user', status: 'active' }] },
    });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });

    await expect(service.addCollaborator('team-123', { username: 'new-user', permission: 'push' }, 'admin-1'))
      .resolves.toEqual(expect.objectContaining({ status }));
    expect(prisma.gitHubRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ collaborators: expect.arrayContaining([
        expect.objectContaining({ username: 'new-user', status }),
      ]) }),
    }));
  });

  it('persists a sanitized failed manual invitation without exposing its external error', async () => {
    (service as any).octokit = { repos: {
      addCollaborator: jest.fn().mockRejectedValue(new Error('github_pat_manual-secret forbidden')),
    } };
    prisma.team.findUnique.mockResolvedValue({
      members: [{ userId: 'admin-1', role: 'admin' }],
      repository: { fullName: 'azync/team-123', collaborators: [] },
    });
    prisma.gitHubRepository.update.mockResolvedValue({ id: 'repo-1' });

    await expect(service.addCollaborator('team-123', { username: 'new-user', permission: 'pull' }, 'admin-1'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'COLLABORATOR_INVITATION_FAILED' }) });
    expect(prisma.gitHubRepository.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ collaborators: [expect.objectContaining({
        username: 'new-user', status: 'failed', error: '[REDACTED] forbidden',
      })] }),
    }));
  });
});
