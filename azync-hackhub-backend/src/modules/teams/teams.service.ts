import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../../events/events.gateway';
import { CreateTeamDto, UpdateTeamDto, AddMemberDto, CreateTeamInviteDto } from './dto/team.dto';
import { AccessPolicyService } from '../access/access-policy.service';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { GITHUB_ROSTER_SYNC, type GithubRosterSync } from '../github/github-roster-sync.token';

@Injectable()
export class TeamsService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private access: AccessPolicyService,
    @Inject(GITHUB_ROSTER_SYNC) private github: GithubRosterSync,
  ) {}

  async create(createTeamDto: CreateTeamDto, userId: string) {
    // Check if hackathon exists
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: createTeamDto.hackathonId },
    });

    if (!hackathon) {
      throw new NotFoundException('Hackathon not found');
    }

    // Create team with creator as admin
    const team = await this.prisma.team.create({
      data: {
        name: createTeamDto.name,
        hackathonId: createTeamDto.hackathonId,
        walletAddress: createTeamDto.walletAddress,
        members: {
          create: {
            userId: userId,
            role: 'admin',
          },
        },
      },
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
    });

    return team;
  }

  async findAll(hackathonId?: string) {
    const where = hackathonId ? { hackathonId } : {};

    return this.prisma.team.findMany({
      where,
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
        _count: {
          select: {
            submissions: true,
          },
        },
      },
    });
  }

  async findOne(id: string, userId: string) {
    await this.access.requireTeamMember(id, userId);
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                githubUsername: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        },
        submissions: {
          select: {
            id: true,
            projectName: true,
            status: true,
            createdAt: true,
          },
        },
        repository: {
          include: {
            workflowRuns: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: { runId: true, headSha: true, status: true, conclusion: true },
            },
          },
        },
        // Registrations are already scoped to this team; filtering the relation
        // by the team id as though it were a hackathon id hid valid records.
        registrations: true,
        areas: {
          include: {
            _count: {
              select: { tasks: true },
            },
          },
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    return team;
  }

  async update(id: string, updateTeamDto: UpdateTeamDto, userId: string) {
    // Check if user is admin
    await this.checkAdminPermission(id, userId);

    return this.prisma.team.update({
      where: { id },
      data: updateTeamDto,
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
    });
  }

  async remove(id: string, userId: string) {
    // Check if user is admin
    await this.checkAdminPermission(id, userId);
    return this.prisma.$transaction(
      async (tx) => {
        const team = await tx.team.findUnique({
          where: { id },
          select: {
            _count: { select: { registrations: true, submissions: true } },
          },
        });
        if (!team) throw new NotFoundException('Team not found');
        if (team._count.submissions > 0) {
          throw new BadRequestException(
            'Cannot delete a team that has final submissions',
          );
        }
        if (team._count.registrations > 0) {
          throw new BadRequestException(
            'Cannot delete a team that is registered for a hackathon',
          );
        }
        return tx.team.delete({ where: { id } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async addMember(id: string, addMemberDto: AddMemberDto, requestUserId: string) {
    // Check if requester is admin
    await this.checkAdminPermission(id, requestUserId);

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: addMemberDto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if already a member
    const existingMember = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId: id,
          userId: addMemberDto.userId,
        },
      },
    });

    if (existingMember) {
      throw new BadRequestException('User is already a member of this team');
    }

    const newMember = await this.prisma.teamMember.create({
      data: {
        teamId: id,
        userId: addMemberDto.userId,
        role: addMemberDto.role || 'member',
      },
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

    // Emit real-time event
    this.eventsGateway.emitToTeam(id, 'team:member-joined', newMember);
    await this.syncCollaboratorsAfterMembershipChange(id);

    return newMember;
  }

  async createInvite(teamId: string, dto: CreateTeamInviteDto, userId: string) {
    await this.checkAdminPermission(teamId, userId);
    const expiresAt = new Date(Date.now() + (dto.expiresInHours ?? 24) * 3_600_000);
    const invite = await this.prisma.teamInvite.create({
      data: { teamId, createdById: userId, code: randomBytes(24).toString('base64url'), expiresAt },
      select: { id: true, code: true, expiresAt: true, createdAt: true },
    });
    return { ...invite, joinPath: `/teams/invites/${invite.code}` };
  }

  async revokeInvite(teamId: string, inviteId: string, userId: string) {
    await this.checkAdminPermission(teamId, userId);
    const revoked = await this.prisma.teamInvite.updateMany({
      where: { id: inviteId, teamId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new NotFoundException('Active team invite not found');
    return { id: inviteId, status: 'revoked' };
  }

  async listInvites(teamId: string, userId: string) {
    await this.checkAdminPermission(teamId, userId);
    return this.prisma.teamInvite.findMany({
      where: { teamId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, code: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async joinInvite(code: string, userId: string) {
    if (!code || code.length < 20) throw new BadRequestException('Invalid team invite');
    try {
      const joined = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const invite = await tx.teamInvite.findUnique({ where: { code } });
        if (!invite || invite.revokedAt || invite.usedAt || invite.expiresAt <= new Date()) {
          throw new BadRequestException('Team invite is expired, revoked, or already used');
        }
        const existing = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId: invite.teamId, userId } },
        });
        if (existing) throw new BadRequestException('You are already a team member');
        // Conditional claim makes simultaneous redemption safe. The enclosing
        // transaction restores the invite if membership insertion cannot commit.
        const claim = await tx.teamInvite.updateMany({
          where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date(), usedById: userId },
        });
        if (claim.count !== 1) throw new BadRequestException('Team invite was already used');
        const member = await tx.teamMember.create({
          data: { teamId: invite.teamId, userId, role: 'member' },
          include: { user: { select: { id: true, name: true, githubUsername: true, avatarUrl: true } } },
        });
        return { teamId: invite.teamId, member, registrationRequired: true };
      });
      await this.syncCollaboratorsAfterMembershipChange(joined.teamId);
      return joined;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Team invite could not be redeemed');
    }
  }

  async removeMember(teamId: string, userId: string, requestUserId: string) {
    // Check if requester is admin or removing themselves
    const isSelf = userId === requestUserId;
    if (!isSelf) {
      await this.checkAdminPermission(teamId, requestUserId);
    }

    // Serializable transaction prevents two simultaneous admin self-removals
    // from both observing two admins and leaving the team ownerless.
    const removedMember = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const member = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
      if (!member) throw new NotFoundException('Member not found');
      if (member.role === 'admin') {
        const adminCount = await tx.teamMember.count({ where: { teamId, role: 'admin' } });
        if (adminCount <= 1) throw new BadRequestException('Cannot remove the last admin');
      }
      return tx.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Emit real-time event
    this.eventsGateway.emitToTeam(teamId, 'team:member-left', { userId, teamId });
    await this.syncCollaboratorsAfterMembershipChange(teamId);

    return removedMember;
  }

  async getMembers(teamId: string, userId: string) {
    await this.access.requireTeamMember(teamId, userId);
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                githubUsername: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    return team.members;
  }

  private async checkAdminPermission(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this team');
    }

    if (member.role !== 'admin') {
      throw new ForbiddenException('Only team admins can perform this action');
    }
  }

  private async syncCollaboratorsAfterMembershipChange(teamId: string): Promise<void> {
    try {
      const outcome = await this.github.syncTeamCollaborators(teamId);
      this.eventsGateway.emitToTeam(teamId, 'repository:collaborators-sync', outcome);
    } catch {
      // Membership has already committed. Surface a retryable sync state rather
      // than falsely reporting that joining/leaving failed.
      this.eventsGateway.emitToTeam(teamId, 'repository:collaborators-sync', { status: 'failed' });
    }
  }
}
