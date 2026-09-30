import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRepoDto, AddCollaboratorDto } from './dto/github.dto';
import { Prisma } from '@prisma/client';
import { EventsGateway } from '../../events/events.gateway';

@Injectable()
export class GithubService {
  private octokit: Octokit | null;
  private orgName: string;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
  ) {
    const token = this.configService.get('GITHUB_TOKEN');
    this.orgName =
      this.configService.get('GITHUB_ORG_NAME') || 'azync-hackhub-contests';

    if (!token || token.trim() === '') {
      console.warn(
        '[GithubService] GITHUB_TOKEN not configured - GitHub features will be disabled',
      );
      this.octokit = null; // GitHub features disabled
    } else {
      this.octokit = new Octokit({ auth: token });
    }
  }

  async createRepository(createRepoDto: CreateRepoDto, userId: string) {
    if (!this.octokit) {
      throw new InternalServerErrorException(
        'GitHub integration is not configured',
      );
    }

    // This endpoint is the explicit "Start building" action. It deliberately
    // does not run during registration or any read operation.
    const team = await this.prisma.team.findUnique({
      where: { id: createRepoDto.teamId },
      include: {
        members: {
          include: {
            user: true,
          },
        },
        repository: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: team.hackathonId },
      include: { judges: { include: { user: true } } },
    });
    if (!hackathon) throw new NotFoundException('Hackathon not found');

    const requester = team.members.find((member) => member.userId === userId);
    if (!requester || requester.role !== 'admin') {
      throw new BadRequestException('Only team admins can start building');
    }

    // A second click is a read of the already provisioned repository. Re-running
    // the seed writer here would replace participant README and workflow changes.
    if (team.repository?.provisioningStatus === 'READY' && team.repository.webhookConfigured) {
      const repository = team.repository;
      return {
        repository,
        githubData: {
          url: repository.url,
          cloneUrl: `${repository.url}.git`,
          sshUrl: `git@github.com:${repository.fullName}.git`,
        },
        webhook: { status: 'configured', error: null },
      };
    }

    try {
      const repoName = this.repositoryName(team.id, team.name);
      const { repository: repo, createdNew } = await this.createOrFindRepository(
        repoName,
        createRepoDto.description || `Repository for team ${team.name}`,
      );

      // Add topics
      if (createRepoDto.topics && createRepoDto.topics.length > 0) {
        await this.octokit.repos.replaceAllTopics({
          owner: this.orgName,
          repo: repoName,
          names: createRepoDto.topics,
        });
      }

      await this.writeRequiredFiles(repoName, team, hackathon.name, createdNew);
      const collaborators = await this.syncCollaborators(
        repoName,
        team,
        hackathon.judges,
      );

      // Persist before webhook setup. If GitHub succeeds but the database or
      // webhook fails, the deterministic name lets a retry reconcile this row
      // and never creates a second repository.
      const gitHubRepo = await this.upsertRepositoryRecord({
        teamId: team.id,
        fullName: repo.data.full_name,
        url: repo.data.html_url,
        collaborators,
        isPrivate: repo.data.private,
      });

      let webhookConfigured = false;
      let webhookError: string | null = null;
      try {
        await this.setupWebhook(repoName);
        webhookConfigured = true;
      } catch (error) {
        webhookError = this.sanitizeWebhookError(error);
      }

      const repository = await this.prisma.gitHubRepository.update({
        where: { id: gitHubRepo.id },
        data: {
          webhookConfigured,
          webhookError,
          provisioningStatus: webhookConfigured ? 'READY' : 'WEBHOOK_PENDING',
          provisioningError: webhookError,
          collaborators,
          isPrivate: repo.data.private,
        },
      });

      return {
        repository,
        githubData: {
          url: repo.data.html_url,
          cloneUrl: repo.data.clone_url,
          sshUrl: repo.data.ssh_url,
        },
        webhook: {
          status: webhookConfigured ? 'configured' : 'failed',
          error: webhookError,
        },
      };
    } catch (error) {
      console.error('GitHub repository provisioning failed:', this.sanitizeWebhookError(error));
      throw new InternalServerErrorException({
        code: 'REPOSITORY_PROVISIONING_FAILED',
        message: 'Repository provisioning failed. Retry Start building to recover.',
      });
    }
  }

  private repositoryName(teamId: string, teamName: string): string {
    const slug = teamName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'team';
    return `team-${teamId.slice(0, 12)}-${slug}`.slice(0, 100);
  }

  private async createOrFindRepository(repoName: string, description: string) {
    if (!this.octokit) throw new Error('GitHub integration is not configured');
    try {
      const created = await this.octokit.repos.createInOrg({
        org: this.orgName, name: repoName, description, private: true,
        auto_init: true, gitignore_template: 'Node',
      });
      return { repository: this.assertRecoveredRepository(created, repoName), createdNew: true };
    } catch (error) {
      // A concurrent request or a prior DB failure can leave the deterministic
      // repository present. Reconcile it instead of issuing another create.
      const status = typeof error === 'object' && error && 'status' in error
        ? (error as { status?: number }).status : undefined;
      if (status !== 409 && status !== 422) throw error;
      const recovered = await this.octokit.repos.get({ owner: this.orgName, repo: repoName });
      return { repository: this.assertRecoveredRepository(recovered, repoName), createdNew: false };
    }
  }

  private assertRecoveredRepository<T extends { data: { full_name: string; private: boolean } }>(
    repository: T,
    repoName: string,
  ): T {
    const expected = `${this.orgName}/${repoName}`.toLowerCase();
    if (repository.data.full_name.toLowerCase() !== expected || repository.data.private !== true) {
      throw new BadRequestException('The existing repository does not match the required private team repository');
    }
    return repository;
  }

  private async writeRequiredFiles(
    repo: string,
    team: any,
    hackathonName: string,
    createdNew: boolean,
  ): Promise<void> {
    const files = {
      'README.md': `# ${team.name}\n\nPrivate MVP repository for ${hackathonName}.\n\nStart building from Azync HackHub.\n`,
      'submission.json': JSON.stringify({
        schemaVersion: 1, teamId: team.id, hackathonId: team.hackathonId,
        teamName: team.name, repositoryVisibility: 'private',
      }, null, 2) + '\n',
      // Participant code is deliberately run only on unprivileged events with
      // read-only permissions. Do not add secrets or pull_request_target here.
      '.github/workflows/ci.yml': "name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\npermissions:\n  contents: read\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n          cache: npm\n      - run: npm ci\n      - run: npm test --if-present\n      - run: npm run build --if-present\n",
    };
    // The Contents API commits at the current branch HEAD. Serialize writes so
    // each commit observes the SHA advanced by the preceding file.
    for (const [path, content] of Object.entries(files)) {
      await this.writeRepositoryFile(repo, path, content, createdNew);
    }
  }

  private async writeRepositoryFile(repo: string, path: string, content: string, overwriteExisting: boolean) {
    if (!this.octokit) throw new Error('GitHub integration is not configured');
    let sha: string | undefined;
    try {
      const current = await this.octokit.repos.getContent({ owner: this.orgName, repo, path });
      if (!Array.isArray(current.data) && 'sha' in current.data) {
        if (!overwriteExisting) return;
        sha = current.data.sha;
      }
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error
        ? (error as { status?: number }).status : undefined;
      if (status !== 404) throw error;
    }
    await this.octokit.repos.createOrUpdateFileContents({
      owner: this.orgName, repo, path, sha, message: `chore: initialize ${path}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
    });
  }

  private async syncCollaborators(repo: string, team: any, judges: any[]) {
    if (!this.octokit) throw new Error('GitHub integration is not configured');
    const people = new Map<string, 'push' | 'pull'>();
    for (const member of team.members) {
      if (member.user.githubUsername) people.set(member.user.githubUsername, 'push');
    }
    for (const judge of judges) {
      if (judge.user.githubUsername && !people.has(judge.user.githubUsername)) {
        people.set(judge.user.githubUsername, 'pull');
      }
    }
    const outcomes: Array<{ username: string; permission: string; status: string; error?: string }> = [];
    for (const [username, permission] of people) {
      try {
        const result = await this.octokit.repos.addCollaborator({ owner: this.orgName, repo, username, permission });
        outcomes.push({ username, permission, status: result.status === 201 ? 'invited' : 'active' });
      } catch (error) {
        outcomes.push({ username, permission, status: 'failed', error: this.sanitizeWebhookError(error) });
      }
    }
    return outcomes;
  }

  async syncTeamCollaborators(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { repository: true, members: { include: { user: true } } },
    });
    if (!team?.repository) return { status: 'not_configured' };
    if (!this.octokit) {
      // The membership/judge mutation has already committed. Record a
      // retryable, user-visible state instead of silently losing the failed
      // provider reconciliation.
      const repository = await this.prisma.gitHubRepository.update({
        where: { teamId },
        data: { provisioningError: 'Collaborator sync pending: GitHub integration is not configured' },
      });
      return { status: 'unavailable', repository };
    }
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: team.hackathonId },
      include: { judges: { include: { user: true } } },
    });
    if (!hackathon) return { status: 'not_configured' };
    const collaborators = await this.syncCollaborators(
      team.repository.fullName.split('/')[1], team, hackathon.judges,
    );
    const authorized = new Set(collaborators.map((item) => item.username));
    const previous = Array.isArray(team.repository.collaborators)
      ? team.repository.collaborators
      : [];
    for (const item of previous) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const prior = item as Record<string, unknown>;
      const username = typeof prior.username === 'string' ? prior.username : null;
      const priorStatus = typeof prior.status === 'string' ? prior.status : null;
      if (!username || authorized.has(username) || !['active', 'invited', 'revoke_failed'].includes(priorStatus || '')) continue;
      try {
        await this.octokit.repos.removeCollaborator({
          owner: this.orgName, repo: team.repository.fullName.split('/')[1], username,
        });
        collaborators.push({ username, permission: String(prior.permission || 'pull'), status: 'revoked' });
      } catch (error) {
        collaborators.push({ username, permission: String(prior.permission || 'pull'), status: 'revoke_failed', error: this.sanitizeWebhookError(error) });
      }
    }
    const incomplete = collaborators.some((item) => item.status === 'failed' || item.status === 'revoke_failed');
    const repository = await this.prisma.gitHubRepository.update({
      where: { teamId }, data: {
        collaborators,
        provisioningError: incomplete
          ? 'Collaborator sync incomplete; retry on the next roster change.'
          : null,
      },
    });
    return { status: 'synced', repository };
  }

  async refreshCollaborators(teamId: string, userId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true, repository: true },
    });
    if (!team?.repository) throw new NotFoundException('Team repository not found');
    if (!team.members.some((member) => member.userId === userId && member.role === 'admin')) {
      throw new BadRequestException('Only team admins can sync repository access');
    }
    const result = await this.syncTeamCollaborators(teamId);
    if (result.status !== 'synced' || result.repository?.provisioningError) {
      throw new InternalServerErrorException('Collaborator sync incomplete; retry after resolving GitHub access');
    }
    return result;
  }

  private async upsertRepositoryRecord(data: any) {
    try {
      return await this.prisma.gitHubRepository.upsert({
        where: { teamId: data.teamId },
        create: { ...data, isPrivate: data.isPrivate, provisioningStatus: 'PROVISIONING' },
        update: { fullName: data.fullName, url: data.url, collaborators: data.collaborators, isPrivate: data.isPrivate, provisioningStatus: 'PROVISIONING', provisioningError: null },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.gitHubRepository.findUniqueOrThrow({ where: { teamId: data.teamId } });
      } else {
        throw error;
      }
    }
  }

  async addCollaborator(
    teamId: string,
    addCollaboratorDto: AddCollaboratorDto,
    userId: string,
  ) {
    if (!this.octokit) {
      throw new InternalServerErrorException(
        'GitHub integration is not configured',
      );
    }

    // Get team and verify user is admin
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: true,
        repository: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    if (!team.repository) {
      throw new BadRequestException('Team does not have a repository');
    }

    // Verify user is admin
    const member = team.members.find((m) => m.userId === userId);
    if (!member || member.role !== 'admin') {
      throw new BadRequestException('Only team admins can add collaborators');
    }

    try {
      const repoName = team.repository.fullName.split('/')[1];

      const result = await this.octokit.repos.addCollaborator({
        owner: this.orgName,
        repo: repoName,
        username: addCollaboratorDto.username,
        permission: addCollaboratorDto.permission || 'push',
      });
      const status = result.status === 201 ? 'invited' : 'active';
      const repository = await this.prisma.gitHubRepository.update({
        where: { teamId },
        data: {
          collaborators: this.withCollaboratorOutcome(
            team.repository.collaborators,
            {
              username: addCollaboratorDto.username,
              permission: addCollaboratorDto.permission || 'push',
              status,
            },
          ),
        },
      });
      return { message: 'Collaborator invitation recorded', status, repository };
    } catch (error) {
      const message = this.sanitizeWebhookError(error);
      console.error('GitHub collaborator invitation failed:', message);
      await this.prisma.gitHubRepository.update({
        where: { teamId },
        data: {
          collaborators: this.withCollaboratorOutcome(
            team.repository.collaborators,
            {
              username: addCollaboratorDto.username,
              permission: addCollaboratorDto.permission || 'push',
              status: 'failed',
              error: message,
            },
          ),
        },
      });
      throw new InternalServerErrorException({
        code: 'COLLABORATOR_INVITATION_FAILED',
        message: 'Collaborator invitation failed. Retry after resolving access.',
      });
    }
  }

  private withCollaboratorOutcome(
    existing: Prisma.JsonValue,
    outcome: { username: string; permission: string; status: string; error?: string },
  ): Prisma.InputJsonValue {
    const prior = Array.isArray(existing)
      ? existing.filter((item) =>
          !item || typeof item !== 'object' || Array.isArray(item) ||
          (item as Record<string, unknown>).username !== outcome.username,
        )
      : [];
    return [...prior, outcome] as Prisma.InputJsonValue;
  }

  private async setupWebhook(repoName: string) {
    if (!this.octokit) {
      throw new Error('GitHub integration is not configured');
    }

    const webhookUrl = this.buildPublicWebhookUrl();
    const webhookSecret = this.configService
      .get<string>('GITHUB_WEBHOOK_SECRET')
      ?.trim();
    if (!webhookSecret) {
      throw new Error('GITHUB_WEBHOOK_SECRET is required');
    }

    const webhook = {
      owner: this.orgName,
      repo: repoName,
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret: webhookSecret,
      },
      events: ['push', 'pull_request', 'workflow_run'],
      active: true,
    };
    const { data: hooks } = await this.octokit.repos.listWebhooks({
      owner: this.orgName,
      repo: repoName,
    });
    const existing = hooks.find((hook) => hook.config?.url === webhookUrl);

    if (existing) {
      await this.octokit.repos.updateWebhook({
        ...webhook,
        hook_id: existing.id,
      });
      return;
    }

    await this.octokit.repos.createWebhook(webhook);
  }

  private buildPublicWebhookUrl(): string {
    const configured = this.configService.get<string>('BACKEND_URL')?.trim();
    if (!configured) throw new Error('BACKEND_URL is required for webhooks');
    let url: URL;
    try {
      url = new URL(configured);
    } catch {
      throw new Error('BACKEND_URL must be a valid absolute URL');
    }
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local')
    ) {
      throw new Error('BACKEND_URL must be a public HTTPS URL for webhooks');
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/webhooks/github`;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  async retryWebhook(teamId: string, userId: string) {
    if (!this.octokit) {
      throw new InternalServerErrorException(
        'GitHub integration is not configured',
      );
    }
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: true, repository: true },
    });
    if (!team?.repository)
      throw new NotFoundException('Team repository not found');
    const member = team.members.find((item) => item.userId === userId);
    if (!member || member.role !== 'admin') {
      throw new BadRequestException('Only team admins can configure webhooks');
    }
    try {
      await this.setupWebhook(team.repository.fullName.split('/')[1]);
      const repository = await this.prisma.gitHubRepository.update({
        where: { teamId },
        data: {
          webhookConfigured: true,
          webhookError: null,
          provisioningStatus: 'READY',
          provisioningError: null,
        },
      });
      return { status: 'configured', repository };
    } catch (error) {
      const message = this.sanitizeWebhookError(error);
      await this.prisma.gitHubRepository.update({
        where: { teamId },
        data: {
          webhookConfigured: false,
          webhookError: message,
          provisioningStatus: 'WEBHOOK_PENDING',
          provisioningError: message,
        },
      });
      throw new InternalServerErrorException({
        code: 'WEBHOOK_CONFIGURATION_FAILED',
        message,
      });
    }
  }

  private sanitizeWebhookError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
      .replace(/(?:ghp|github_pat)_[A-Za-z0-9_-]+/g, '[REDACTED]')
      .slice(0, 1000);
  }

  async handleWebhook(input: {
    event: string;
    deliveryId: string;
    hookId: string | null;
    payloadHash: string;
    payload: unknown;
  }) {
    const repositoryFullName = this.readRepositoryFullName(
      input.payload,
      input.event !== 'ping',
    );
    let redelivery = false;
    const leaseUntil = new Date(Date.now() + this.webhookProcessingLeaseMs());
    try {
      await this.prisma.gitHubWebhookDelivery.create({
        data: {
          deliveryId: input.deliveryId,
          event: input.event,
          hookId: input.hookId,
          repositoryFullName,
          payloadHash: input.payloadHash,
          status: 'PROCESSING',
          processingLeaseUntil: leaseUntil,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.gitHubWebhookDelivery.findUnique({
          where: { deliveryId: input.deliveryId },
        });
        if (!existing || existing.payloadHash !== input.payloadHash) {
          throw new BadRequestException(
            'Delivery identifier was reused with a different payload',
          );
        }
        // A GitHub redelivery of a failed event is a recovery mechanism, not a
        // permanent duplicate. Atomically claim only failed deliveries so an
        // in-flight delivery is never processed twice.
        if (existing.status === 'FAILED') {
          const reclaimed = await this.prisma.gitHubWebhookDelivery.updateMany({
            where: { deliveryId: input.deliveryId, status: 'FAILED' },
            data: {
              status: 'PROCESSING',
              errorCode: null,
              errorMessage: null,
              processedAt: null,
              processingLeaseUntil: leaseUntil,
            },
          });
          if (reclaimed.count === 1) redelivery = true;
          else {
            return {
              deliveryId: input.deliveryId,
              duplicate: true,
              status: existing.status.toLowerCase(),
              result: existing.result,
            };
          }
        } else if (existing.status === 'PROCESSING') {
          // Recover only after a bounded lease has expired. A fresh in-flight
          // delivery remains an idempotent duplicate and is never double-run.
          const now = new Date();
          const cutoff = new Date(now.getTime() - this.webhookProcessingLeaseMs());
          const reclaimed = await this.prisma.gitHubWebhookDelivery.updateMany({
            where: {
              deliveryId: input.deliveryId,
              status: 'PROCESSING',
              OR: [
                { processingLeaseUntil: { lt: now } },
                { processingLeaseUntil: null, receivedAt: { lt: cutoff } },
              ],
            },
            data: {
              processingLeaseUntil: leaseUntil,
              errorCode: null,
              errorMessage: null,
              processedAt: null,
            },
          });
          if (reclaimed.count === 1) redelivery = true;
          else return {
            deliveryId: input.deliveryId,
            duplicate: true,
            status: existing.status.toLowerCase(),
            result: existing.result,
          };
        } else {
          return {
            deliveryId: input.deliveryId,
            duplicate: true,
            status: existing.status.toLowerCase(),
            result: existing.result,
          };
        }
      } else {
        throw error;
      }
    }

    try {
      const result = await this.processWebhookEvent(
        input.event,
        input.payload,
        repositoryFullName,
      );
      await this.prisma.gitHubWebhookDelivery.update({
        where: { deliveryId: input.deliveryId },
        data: {
          status: 'COMPLETED',
          result: result as Prisma.InputJsonValue,
          processedAt: new Date(),
          processingLeaseUntil: null,
        },
      });
      return { deliveryId: input.deliveryId, duplicate: false, redelivery, ...result };
    } catch (error) {
      await this.prisma.gitHubWebhookDelivery.update({
        where: { deliveryId: input.deliveryId },
        data: {
          status: 'FAILED',
          errorCode:
            error instanceof BadRequestException
              ? 'INVALID_PAYLOAD'
              : 'PROCESSING_FAILED',
          errorMessage: this.sanitizeWebhookError(error),
          processedAt: new Date(),
          processingLeaseUntil: null,
        },
      });
      throw error;
    }
  }

  private async processWebhookEvent(
    event: string,
    payload: unknown,
    repositoryFullName: string | null,
  ): Promise<Record<string, unknown>> {
    switch (event) {
      case 'ping':
        return { status: 'accepted', event };
      case 'push':
        return this.handlePushEvent(payload, repositoryFullName!);
      case 'pull_request':
        return this.handlePullRequestEvent(payload, repositoryFullName!);
      case 'workflow_run':
        return this.handleWorkflowRunEvent(payload, repositoryFullName!);
      default:
        return { status: 'ignored', event };
    }
  }

  private async handlePushEvent(
    payload: unknown,
    repoFullName: string,
  ): Promise<Record<string, unknown>> {
    const body = this.asRecord(payload);
    if (body.ref !== `refs/heads/${this.workflowBranch()}`) {
      return { status: 'ignored', event: 'push', reason: 'non_default_branch' };
    }
    const commits = Array.isArray(body.commits) ? body.commits : [];
    const after = typeof body.after === 'string' ? body.after : null;

    const repo = await this.prisma.gitHubRepository.findFirst({
      where: { fullName: repoFullName },
    });

    if (!repo) {
      return { status: 'ignored', reason: 'repository_not_registered' };
    }

    const submissions = await this.prisma.submission.findMany({
      where: { teamId: repo.teamId },
      select: { id: true },
    });
    const submissionIds = submissions.map((submission) => submission.id);
    const [, staleUpdate] = await this.prisma.$transaction([
      this.prisma.gitHubRepository.update({
        where: { id: repo.id },
        data: {
          lastWebhookAt: new Date(),
          lastPushAt: new Date(),
          lastCommitSha: after,
        },
      }),
      this.prisma.aiContextSession.updateMany({
        where: {
          submissionId: { in: submissionIds },
          ...(after
            ? {
                OR: [
                  { latestRevision: null },
                  { latestRevision: { not: after } },
                ],
              }
            : {}),
        },
        data: { status: 'STALE' },
      }),
    ]);
    this.eventsGateway.emitToTeam(repo.teamId, 'repository:updated', {
      lastCommitSha: after,
      lastPushAt: new Date().toISOString(),
      staleSubmissionCount: staleUpdate.count,
    });

    return {
      status: 'processed',
      event: 'push',
      commitCount: commits.length,
      staleSubmissionCount: staleUpdate.count,
    };
  }

  private async handlePullRequestEvent(
    payload: unknown,
    repositoryFullName: string,
  ): Promise<Record<string, unknown>> {
    const body = this.asRecord(payload);
    const action = typeof body.action === 'string' ? body.action : 'unknown';
    const updated = await this.prisma.gitHubRepository.updateMany({
      where: { fullName: repositoryFullName },
      data: { lastWebhookAt: new Date(), lastPullRequestAt: new Date() },
    });
    return {
      status: updated.count > 0 ? 'processed' : 'ignored',
      event: 'pull_request',
      action,
    };
  }

  private async handleWorkflowRunEvent(
    payload: unknown,
    repositoryFullName: string,
  ): Promise<Record<string, unknown>> {
    const body = this.asRecord(payload);
    const workflow = this.asRecord(body.workflow_run);
    const action = typeof body.action === 'string' ? body.action : null;
    if (!action || !['requested', 'in_progress', 'completed'].includes(action)) {
      return { status: 'ignored', event: 'workflow_run', reason: 'unsupported_workflow_action' };
    }
    const repo = await this.prisma.gitHubRepository.findFirst({
      where: { fullName: repositoryFullName },
    });
    if (!repo) return { status: 'ignored', reason: 'repository_not_registered' };

    const runId = this.positiveIdentifier(workflow.id);
    const runAttempt = this.positiveInteger(workflow.run_attempt);
    const headSha = this.commitSha(workflow.head_sha);
    const headBranch = typeof workflow.head_branch === 'string' ? workflow.head_branch.trim() : '';
    const triggerEvent = typeof workflow.event === 'string' ? workflow.event : '';
    const headRepository = this.asRecord(workflow.head_repository);
    const headRepositoryName = typeof headRepository.full_name === 'string' ? headRepository.full_name.trim() : '';
    if (!runId || !runAttempt || !headSha || headBranch !== this.workflowBranch() || triggerEvent !== 'push' || headRepositoryName !== repositoryFullName) {
      throw new BadRequestException('Workflow run is not bound to this repository push');
    }
    const updatedAt = this.dateValue(workflow.updated_at);
    if (!updatedAt) throw new BadRequestException('Workflow run is missing updated_at');
    const status = typeof workflow.status === 'string' ? workflow.status : null;
    const conclusion =
      typeof workflow.conclusion === 'string' ? workflow.conclusion : null;
    if (!status) throw new BadRequestException('Workflow run is missing status');
    const testStatus = action === 'completed'
      ? (conclusion === 'success' ? 'PASSED' : conclusion ? 'FAILED' : 'UNKNOWN')
      : 'UNKNOWN';
    const runData = {
      headSha,
      headBranch,
      triggerEvent,
      status,
      conclusion,
      startedAt: this.dateValue(workflow.run_started_at),
      completedAt: action === 'completed' ? this.dateValue(workflow.updated_at) : null,
      updatedAt,
      testStatus,
      // GitHub's workflow_run webhook does not attest a coverage artifact.
      coverageStatus: 'UNKNOWN',
      trustLimitations: [
        'Workflow metadata is signed by GitHub but test logs and coverage artifacts were not independently verified.',
      ],
    };
    let persisted = await this.prisma.gitHubWorkflowRun.updateMany({
      where: { repositoryId: repo.id, runId, runAttempt, updatedAt: { lte: updatedAt } },
      data: runData,
    });
    if (persisted.count === 0) {
      try {
        await this.prisma.gitHubWorkflowRun.create({
          data: { repositoryId: repo.id, runId, runAttempt, ...runData },
        });
        persisted = { count: 1 };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
    if (persisted.count === 0) {
      return { status: 'ignored', event: 'workflow_run', reason: 'out_of_order_run', runId, runAttempt };
    }
    await this.prisma.gitHubRepository.updateMany({
      where: { id: repo.id, OR: [{ lastWorkflowRunAt: null }, { lastWorkflowRunAt: { lt: updatedAt } }] },
      data: {
        lastWebhookAt: new Date(),
        // Store the GitHub event timestamp, not receipt time, so delayed
        // deliveries cannot make older CI state look newer.
        lastWorkflowRunAt: updatedAt,
        lastWorkflowStatus: status,
        lastWorkflowConclusion: conclusion,
      },
    });
    const team = await this.prisma.team.findUnique({
      where: { id: repo.teamId },
      select: { hackathonId: true },
    });
    if (team) {
      this.eventsGateway.emitToPublicHackathon(
        team.hackathonId,
        'leaderboard:invalidated',
        { source: 'ci', updatedAt: updatedAt.toISOString() },
      );
    }
    return {
      status: 'processed',
      event: 'workflow_run',
      runId,
      runAttempt,
      headSha,
      workflowStatus: status,
      workflowConclusion: conclusion,
      testStatus,
      coverageStatus: 'UNKNOWN',
      trustLimitations: runData.trustLimitations,
    };
  }

  private positiveIdentifier(value: unknown): string | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const normalized = String(value);
    return /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
  }

  private positiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  private commitSha(value: unknown): string | null {
    return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;
  }

  private dateValue(value: unknown): Date | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private workflowBranch(): string {
    const configured = this.configService.get<string>('GITHUB_WORKFLOW_BRANCH')?.trim();
    return configured && /^[^\s/][^\s]*$/.test(configured) ? configured : 'main';
  }

  private webhookProcessingLeaseMs(): number {
    const configured = Number(this.configService.get<string>('GITHUB_WEBHOOK_PROCESSING_LEASE_MS'));
    // A short lease makes recovery practical; a ceiling prevents an accidental
    // configuration from suppressing recovery for an entire delivery window.
    if (!Number.isFinite(configured) || configured < 10_000 || configured > 15 * 60_000) return 5 * 60_000;
    return Math.floor(configured);
  }

  private readRepositoryFullName(
    payload: unknown,
    required: boolean,
  ): string | null {
    const body = this.asRecord(payload);
    const repository = this.asRecord(body.repository);
    const fullName = repository.full_name;
    if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
    if (required) {
      throw new BadRequestException(
        'Webhook payload is missing repository.full_name',
      );
    }
    return null;
  }

  private asRecord(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, any>)
      : {};
  }
}
