import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../../events/events.gateway';
import { Prisma } from '@prisma/client';
import { AccessPolicyService } from '../access/access-policy.service';
import {
  CreateHackathonDto,
  UpdateHackathonDto,
  RegisterTeamDto,
  AssignJudgeDto,
  CreateTrackDto,
  UpdateTrackDto,
} from './dto/hackathon.dto';
import { buildLeaderboardEntries } from './leaderboard';
import {
  GITHUB_ROSTER_SYNC,
  type GithubRosterSync,
} from '../github/github-roster-sync.token';
import { SolanaService } from '../solana/solana.service';

@Injectable()
export class HackathonsService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private access: AccessPolicyService,
    @Inject(GITHUB_ROSTER_SYNC) private github: GithubRosterSync,
    @Optional() private solana?: SolanaService,
  ) {}

  async create(createHackathonDto: CreateHackathonDto, organizerId: string) {
    const { startDate, endDate, ...rest } = createHackathonDto;

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new BadRequestException('End date must be after start date');
    }
    this.validateRulesAndRubric(
      createHackathonDto.rules,
      createHackathonDto.rubric,
    );

    return this.prisma.hackathon.create({
      data: {
        ...rest,
        organizerId,
        startDate: start,
        endDate: end,
        rules: (createHackathonDto.rules ||
          []) as unknown as Prisma.InputJsonValue,
        rubric: (createHackathonDto.rubric ||
          []) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(includeEnded: boolean = false) {
    const now = new Date();

    const hackathons = await this.prisma.hackathon.findMany({
      where: includeEnded
        ? { isPublished: true }
        : { isPublished: true, endDate: { gte: now } },
      include: {
        tracks: { where: { isActive: true }, orderBy: { name: 'asc' } },
        _count: {
          select: {
            registrations: true,
            submissions: true,
          },
        },
      },
      orderBy: {
        startDate: 'desc',
      },
    });
    return hackathons.map((hackathon) => this.publicHackathon(hackathon));
  }

  async findOwned(organizerId: string) {
    return this.prisma.hackathon.findMany({
      where: { organizerId },
      include: {
        tracks: { orderBy: { name: 'asc' } },
        _count: { select: { registrations: true, submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        description: true,
        coverUrl: true,
        isPublished: true,
        rules: true,
        rubric: true,
        rulesVersion: true,
        rubricVersion: true,
        createdAt: true,
        updatedAt: true,
        tracks: { where: { isActive: true }, orderBy: { name: 'asc' } },
        _count: { select: { registrations: true, submissions: true } },
      },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }

    if (hackathon.isPublished === false)
      throw new NotFoundException('Hackathon not found');

    return this.publicHackathon(hackathon);
  }

  async update(
    id: string,
    updateHackathonDto: UpdateHackathonDto,
    organizerId: string,
  ) {
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }
    await this.requireOrganizer(id, organizerId);

    const { startDate, endDate, ...rest } = updateHackathonDto;

    const updateData: any = { ...rest };
    if (updateHackathonDto.rules !== undefined)
      updateData.rulesVersion = `rules-${Date.now()}`;
    if (updateHackathonDto.rubric !== undefined)
      updateData.rubricVersion = `rubric-${Date.now()}`;

    if (startDate) {
      updateData.startDate = new Date(startDate);
    }

    if (endDate) {
      updateData.endDate = new Date(endDate);
    }

    // Always validate against the persisted counterpart: PATCH may contain only one date.
    const effectiveStart = updateData.startDate ?? hackathon.startDate;
    const effectiveEnd = updateData.endDate ?? hackathon.endDate;
    if (effectiveStart >= effectiveEnd) {
      throw new BadRequestException('End date must be after start date');
    }
    this.validateRulesAndRubric(
      updateHackathonDto.rules,
      updateHackathonDto.rubric,
    );

    return this.prisma.hackathon.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string, organizerId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const hackathon = await tx.hackathon.findUnique({
          where: { id },
          select: {
            organizerId: true,
            _count: { select: { registrations: true, submissions: true } },
          },
        });
        if (!hackathon) throw new NotFoundException('Hackathon not found');
        if (hackathon.organizerId !== organizerId) {
          throw new ForbiddenException(
            'Only the hackathon organizer may perform this action',
          );
        }
        if (hackathon._count.submissions > 0) {
          throw new BadRequestException(
            'Cannot delete a hackathon that has final submissions; archive it instead',
          );
        }
        if (hackathon._count.registrations > 0) {
          throw new BadRequestException(
            'Cannot delete a hackathon that has registered teams; archive it instead',
          );
        }
        return tx.hackathon.delete({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async registerTeam(
    hackathonId: string,
    registerTeamDto: RegisterTeamDto,
    userId: string,
  ) {
    // Check if hackathon exists
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }

    if (hackathon.isPublished === false)
      throw new BadRequestException('Hackathon is not published');
    // Check if hackathon has started or ended
    const now = new Date();
    if (now > hackathon.endDate) {
      throw new BadRequestException('Hackathon has already ended');
    }

    // Check if team exists
    const team = await this.prisma.team.findUnique({
      where: { id: registerTeamDto.teamId },
      include: {
        members: true,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    // Check if user is a member of the team
    const isMember = team.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this team');
    }

    // Check if team belongs to this hackathon
    if (team.hackathonId !== hackathonId) {
      throw new BadRequestException('Team does not belong to this hackathon');
    }
    if (registerTeamDto.trackId)
      await this.requireActiveTrack(hackathonId, registerTeamDto.trackId);

    // Check if already registered
    const existingRegistration =
      await this.prisma.hackathonRegistration.findUnique({
        where: {
          hackathonId_teamId: {
            hackathonId,
            teamId: registerTeamDto.teamId,
          },
        },
      });

    if (existingRegistration) {
      throw new BadRequestException(
        'Team is already registered for this hackathon',
      );
    }

    const registration = await this.prisma.hackathonRegistration.create({
      data: {
        hackathonId,
        teamId: registerTeamDto.teamId,
        trackId: registerTeamDto.trackId,
      },
      include: {
        team: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    githubUsername: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    void this.emitLeaderboardUpdate(hackathonId);
    return registration;
  }

  async getRegisteredTeams(hackathonId: string, userId: string) {
    await this.access.requireHackathonOrganizer(hackathonId, userId);
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
      include: {
        registrations: {
          include: {
            team: {
              include: {
                members: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        githubUsername: true,
                        avatarUrl: true,
                      },
                    },
                  },
                },
                submissions: {
                  select: {
                    id: true,
                    projectName: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }

    return hackathon.registrations.map((r) => ({
      ...r.team,
      registeredAt: r.registeredAt,
    }));
  }

  async getSubmissions(hackathonId: string, userId: string) {
    await this.access.requireHackathonPrivateAccess(hackathonId, userId);
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
      include: {
        submissions: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
                members: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        githubUsername: true,
                        avatarUrl: true,
                      },
                    },
                  },
                },
              },
            },
            aiAnalyses: {
              orderBy: {
                createdAt: 'desc',
              },
              take: 1,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }

    const detailed =
      hackathon.organizerId === userId ||
      (await this.access.isHackathonJudge(hackathonId, userId));
    return detailed
      ? hackathon.submissions
      : hackathon.submissions.map((submission) => ({
          id: submission.id,
          teamId: submission.teamId,
          projectName: submission.projectName,
          status: submission.status,
          createdAt: submission.createdAt,
          team: { id: submission.team.id, name: submission.team.name },
        }));
  }

  async listOrganizerSubmissions(
    hackathonId: string,
    userId: string,
    query: {
      cursor?: string;
      limit?: number;
      search?: string;
      trackId?: string;
      status?: string;
    },
  ) {
    await this.access.requireHackathonOrganizer(hackathonId, userId);
    await this.validateOrganizerSubmissionFilters(hackathonId, query);
    const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const where = this.organizerSubmissionWhere(hackathonId, query);
    if (
      query.cursor &&
      !(await this.prisma.submission.findFirst({
        where: { id: query.cursor, ...where },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Invalid submission cursor');
    const [rows, winner] = await Promise.all([
      this.prisma.submission.findMany({
        where,
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          projectName: true,
          createdAt: true,
          status: true,
          receivedStatus: true,
          aiStatus: true,
          mintStatus: true,
          trackId: true,
          githubUrl: true,
          demoUrl: true,
          participantBlockchainEvidenceUrl: true,
          transactionSignature: true,
          nftAssetId: true,
          team: { select: { id: true, name: true } },
          track: { select: { id: true, name: true } },
        },
      }),
      this.prisma.winnerAward.findUnique({
        where: { hackathonId },
        include: {
          submission: {
            select: {
              projectName: true,
              team: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...row,
      track: row.track ?? null,
      isWinner: winner?.submissionId === row.id,
    }));
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      limit,
      winner: winner ? this.winnerAwardView(winner) : null,
    };
  }

  async selectWinner(
    hackathonId: string,
    submissionId: string,
    userId: string,
  ) {
    await this.access.requireHackathonOrganizer(hackathonId, userId);
    const [hackathon, submission, existing] = await Promise.all([
      this.prisma.hackathon.findUnique({
        where: { id: hackathonId },
        select: { id: true, name: true, endDate: true },
      }),
      this.prisma.submission.findFirst({
        where: { id: submissionId, hackathonId },
        include: { team: { select: { id: true, name: true } } },
      }),
      this.prisma.winnerAward.findUnique({ where: { hackathonId } }),
    ]);
    if (!hackathon) throw new NotFoundException('Hackathon not found');
    if (new Date() < hackathon.endDate)
      throw new BadRequestException(
        'A winner can be selected only after the hackathon deadline',
      );
    if (!submission?.finalSnapshot || !submission.finalizedAt)
      throw new BadRequestException(
        'Winner must be a final submission from this hackathon',
      );
    if (existing && existing.submissionId !== submissionId) {
      throw new BadRequestException(
        'This hackathon already has a different winner; winner decisions are immutable',
      );
    }

    let award = existing;
    if (!award) {
      const selectedAt = new Date();
      const snapshot = {
        schemaVersion: 1,
        awardVersion: 1,
        awardType: 'HACKATHON_WINNER',
        hackathonId,
        hackathonName: hackathon.name,
        submissionId: submission.id,
        teamId: submission.team.id,
        teamName: submission.team.name,
        projectName: submission.projectName,
        recipientAddress: submission.walletAddress,
        selectedById: userId,
        selectedAt: selectedAt.toISOString(),
      };
      try {
        award = await this.prisma.winnerAward.create({
          data: {
            hackathonId,
            submissionId,
            selectedById: userId,
            recipientAddress: submission.walletAddress,
            decisionSnapshot: snapshot as Prisma.InputJsonValue,
            selectedAt,
          },
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        )
          throw error;
        award = await this.prisma.winnerAward.findUnique({
          where: { hackathonId },
        });
        if (!award || award.submissionId !== submissionId)
          throw new BadRequestException('This hackathon already has a winner');
      }
    }

    if (!this.solana)
      throw new ServiceUnavailableException(
        'Winner certificate service is unavailable',
      );
    try {
      await this.solana.mintWinnerCredential(award.id);
    } catch (error) {
      const current = await this.prisma.winnerAward.findUnique({
        where: { id: award.id },
      });
      if (!current) throw error;
      this.eventsGateway.emitToHackathon(hackathonId, 'winner:selected', {
        awardId: award.id,
        submissionId,
        status: current.status,
      });
      return {
        ...this.winnerAwardView({
          ...current,
          submission: {
            projectName: submission.projectName,
            team: submission.team,
          },
        }),
        mintError: String((error as Error)?.message ?? error).slice(0, 500),
      };
    }
    const confirmed = await this.prisma.winnerAward.findUnique({
      where: { id: award.id },
      include: {
        submission: {
          select: {
            projectName: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
    });
    this.eventsGateway.emitToHackathon(hackathonId, 'winner:selected', {
      awardId: award.id,
      submissionId,
      status: confirmed?.status,
    });
    this.eventsGateway.emitToTeam(submission.team.id, 'winner:selected', {
      awardId: award.id,
      hackathonId,
      submissionId,
      status: confirmed?.status,
    });
    return this.winnerAwardView(confirmed);
  }

  async retryWinnerCertificate(hackathonId: string, userId: string) {
    await this.access.requireHackathonOrganizer(hackathonId, userId);
    const award = await this.prisma.winnerAward.findUnique({
      where: { hackathonId },
    });
    if (!award) throw new NotFoundException('Winner has not been selected');
    if (!this.solana)
      throw new ServiceUnavailableException(
        'Winner certificate service is unavailable',
      );
    await this.solana.mintWinnerCredential(award.id);
    const current = await this.prisma.winnerAward.findUnique({
      where: { id: award.id },
      include: {
        submission: {
          select: {
            projectName: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
    });
    return this.winnerAwardView(current);
  }

  private winnerAwardView(award: any) {
    if (!award) return null;
    return {
      id: award.id,
      hackathonId: award.hackathonId,
      submissionId: award.submissionId,
      status: award.status,
      selectedAt: award.selectedAt,
      confirmedAt: award.confirmedAt,
      recipientAddress: award.recipientAddress,
      signature: award.signature,
      nftAssetId: award.nftAssetId,
      credentialHash: award.credentialHash,
      metadataUri: award.metadataUri,
      network: award.network,
      leafIndex: award.leafIndex?.toString() ?? null,
      explorerUrl:
        award.signature && this.solana
          ? this.solana.getExplorerUrl(award.signature)
          : null,
      verifyPath: `/solana/winner-credentials/${award.id}/verify`,
      projectName: award.submission?.projectName ?? null,
      team: award.submission?.team ?? null,
      errorMessage: award.errorMessage ?? null,
    };
  }

  async exportOrganizerSubmissionsCsv(
    hackathonId: string,
    userId: string,
    query: { search?: string; trackId?: string; status?: string },
  ) {
    await this.access.requireHackathonOrganizer(hackathonId, userId);
    await this.validateOrganizerSubmissionFilters(hackathonId, query);
    const maxRows = 500;
    const items = await this.prisma.submission.findMany({
      where: this.organizerSubmissionWhere(hackathonId, query),
      take: maxRows + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        projectName: true,
        createdAt: true,
        receivedStatus: true,
        aiStatus: true,
        mintStatus: true,
        team: { select: { name: true } },
        track: { select: { name: true } },
      },
    });
    if (items.length > maxRows)
      throw new BadRequestException(
        `CSV export is limited to ${maxRows} rows; narrow the active filters`,
      );
    const escape = (value: unknown) => {
      const text = String(value ?? '');
      const neutralized = /^[\u0000-\u0020]*[=+\-@]/.test(text)
        ? `'${text}`
        : text;
      return `"${neutralized.replace(/"/g, '""')}"`;
    };
    const headers = [
      'team',
      'project',
      'track',
      'submittedAt',
      'receivedStatus',
      'aiStatus',
      'solanaStatus',
    ];
    const lines = items.map((item) =>
      [
        item.team.name,
        item.projectName,
        item.track?.name ?? '',
        item.createdAt.toISOString(),
        item.receivedStatus,
        item.aiStatus,
        item.mintStatus,
      ]
        .map(escape)
        .join(','),
    );
    return `\uFEFF${headers.join(',')}\n${lines.join('\n')}`;
  }

  private organizerSubmissionWhere(
    hackathonId: string,
    query: { search?: string; trackId?: string; status?: string },
  ) {
    const search = query.search?.trim();
    return {
      hackathonId,
      ...(query.trackId ? { trackId: query.trackId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              {
                projectName: { contains: search, mode: 'insensitive' as const },
              },
              {
                team: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {}),
    };
  }

  private async validateOrganizerSubmissionFilters(
    hackathonId: string,
    query: { trackId?: string; status?: string },
  ) {
    const statuses = new Set([
      'confirmed',
      'pending_nft',
      'nft_failed',
      'mint_pending_reconciliation',
    ]);
    if (query.status && !statuses.has(query.status)) {
      throw new BadRequestException('Invalid submission status filter');
    }
    if (query.trackId) {
      const track = await this.prisma.track.findFirst({
        where: { id: query.trackId, hackathonId },
        select: { id: true },
      });
      if (!track) {
        throw new BadRequestException('Invalid submission track filter');
      }
    }
  }

  async assignJudge(
    hackathonId: string,
    dto: AssignJudgeDto,
    organizerId: string,
  ) {
    await this.requireOrganizer(hackathonId, organizerId);
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new NotFoundException('User not found');
    const assignment = await this.prisma.hackathonJudge.upsert({
      where: { hackathonId_userId: { hackathonId, userId: dto.userId } },
      update: {},
      create: { hackathonId, userId: dto.userId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            githubUsername: true,
            avatarUrl: true,
          },
        },
      },
    });
    await this.syncHackathonRepositories(hackathonId);
    return assignment;
  }

  async listJudges(hackathonId: string, organizerId: string) {
    await this.requireOrganizer(hackathonId, organizerId);
    return this.prisma.hackathonJudge.findMany({
      where: { hackathonId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            githubUsername: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { assignedAt: 'asc' },
    });
  }

  async removeJudge(hackathonId: string, userId: string, organizerId: string) {
    await this.requireOrganizer(hackathonId, organizerId);
    const assignment = await this.prisma.hackathonJudge.findUnique({
      where: { hackathonId_userId: { hackathonId, userId } },
    });
    if (!assignment) throw new NotFoundException('Judge assignment not found');
    const removed = await this.prisma.hackathonJudge.delete({
      where: { hackathonId_userId: { hackathonId, userId } },
    });
    await this.syncHackathonRepositories(hackathonId);
    return removed;
  }

  private async syncHackathonRepositories(hackathonId: string): Promise<void> {
    const teams = await this.prisma.team.findMany({
      where: { hackathonId },
      select: { id: true },
    });
    // Judge changes can affect many repositories. Keep provider calls bounded
    // so a large event neither overwhelms GitHub nor starves retries.
    const concurrency = 4;
    for (let index = 0; index < teams.length; index += concurrency) {
      await Promise.all(
        teams.slice(index, index + concurrency).map(async ({ id }) => {
          try {
            const outcome = await this.github.syncTeamCollaborators(id);
            this.eventsGateway.emitToTeam(
              id,
              'repository:collaborators-sync',
              outcome,
            );
          } catch {
            this.eventsGateway.emitToTeam(id, 'repository:collaborators-sync', {
              status: 'failed',
            });
          }
        }),
      );
    }
  }

  async getLeaderboard(hackathonId: string) {
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }
    if (hackathon.isPublished === false)
      throw new NotFoundException('Hackathon not found');

    // Task progress is the ranking metric. CI is an independent signal and is
    // never blended into an official score.
    const teams = await this.prisma.team.findMany({
      where: {
        hackathonId,
        registrations: {
          some: {
            hackathonId,
          },
        },
      },
      include: {
        tasks: {
          select: {
            status: true,
            updatedAt: true,
          },
        },
        registrations: {
          where: { hackathonId },
          select: { registeredAt: true },
          take: 1,
        },
        repository: {
          select: {
            lastCommitSha: true,
            workflowRuns: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: {
                runId: true,
                runAttempt: true,
                headSha: true,
                status: true,
                conclusion: true,
                testStatus: true,
                coverageStatus: true,
                trustLimitations: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
    const leaderboard = buildLeaderboardEntries(teams);

    const result = {
      hackathonId,
      hackathonName: hackathon.name,
      definition: {
        rankingMetric: 'task_completion_percent',
        formula: 'completed tasks / total tasks * 100; an empty board is 0%',
        tiePolicy:
          'Equal percentages share a competition rank; display order is team name then team ID.',
        officialScore: false,
        ciMeaning:
          'CI is shown separately from rank; participant-controlled workflows are not an official score.',
      },
      leaderboard,
      lastUpdated: new Date(),
    };

    return result;
  }

  async listTracks(hackathonId: string) {
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
      select: { isPublished: true },
    });
    if (!hackathon || !hackathon.isPublished)
      throw new NotFoundException('Hackathon not found');
    return this.prisma.track.findMany({
      where: { hackathonId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async createTrack(hackathonId: string, dto: CreateTrackDto, userId: string) {
    await this.requireOrganizer(hackathonId, userId);
    return this.prisma.track.create({ data: { hackathonId, ...dto } });
  }

  async updateTrack(
    hackathonId: string,
    trackId: string,
    dto: UpdateTrackDto,
    userId: string,
  ) {
    await this.requireOrganizer(hackathonId, userId);
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, hackathonId },
    });
    if (!track) throw new NotFoundException('Track not found');
    if (
      (dto.name !== undefined || dto.description !== undefined) &&
      (await this.prisma.submission.count({ where: { hackathonId, trackId } }))
    )
      throw new BadRequestException(
        'Track configuration cannot change after a submission exists',
      );
    return this.prisma.track.update({ where: { id: trackId }, data: dto });
  }

  async emitLeaderboardUpdate(hackathonId: string) {
    try {
      const leaderboard = await this.getLeaderboard(hackathonId);
      this.eventsGateway.emitToPublicHackathon(
        hackathonId,
        'leaderboard:updated',
        leaderboard,
      );
    } catch (error) {
      // Silently fail - leaderboard updates are not critical
      console.error(
        `Failed to emit leaderboard update for ${hackathonId}:`,
        error,
      );
    }
  }

  private async requireOrganizer(hackathonId: string, userId: string) {
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId },
      select: { organizerId: true },
    });
    if (!hackathon) throw new NotFoundException('Hackathon not found');
    if (!hackathon.organizerId) {
      throw new ForbiddenException(
        'Only the hackathon organizer may perform this action',
      );
    }
    if (hackathon.organizerId !== userId) {
      throw new ForbiddenException(
        'Only the hackathon organizer may perform this action',
      );
    }
  }

  private async requireActiveTrack(hackathonId: string, trackId: string) {
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, hackathonId, isActive: true },
    });
    if (!track)
      throw new BadRequestException('Track is not active for this hackathon');
    return track;
  }

  private publicHackathon(hackathon: any) {
    const { organizerId, registrations, submissions, judges, ...safe } =
      hackathon;
    return safe;
  }

  private validateRulesAndRubric(
    rules?: Array<{ id: string }>,
    rubric?: Array<{
      id: string;
      minScore: number;
      maxScore: number;
      weight: number;
    }>,
  ) {
    if (rules && new Set(rules.map((rule) => rule.id)).size !== rules.length)
      throw new BadRequestException('Rule IDs must be unique');
    if (!rubric) return;
    if (new Set(rubric.map((criterion) => criterion.id)).size !== rubric.length)
      throw new BadRequestException('Rubric IDs must be unique');
    if (rubric.some((criterion) => criterion.minScore > criterion.maxScore))
      throw new BadRequestException(
        'Rubric minimum score must not exceed maximum score',
      );
    const total = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (rubric.length && Math.abs(total - 1) > 0.00001)
      throw new BadRequestException('Rubric weights must sum to 1');
  }
}
