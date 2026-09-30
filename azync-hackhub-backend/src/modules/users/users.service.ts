import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findOne(id: string, includePrivate = false) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        githubId: true,
        githubUsername: true,
        ...(includePrivate ? { email: true, university: true, skills: true } : {}),
        name: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async updateProfile(id: string, data: { university?: string; skills?: string[] }) {
    return this.prisma.user.update({ where: { id }, data, select: { id: true, githubUsername: true, name: true, avatarUrl: true, email: true, university: true, skills: true } });
  }

  async findByGithubId(githubId: string) {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        githubId: true,
        githubUsername: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByGithubUsername(githubUsername: string) {
    return this.prisma.user.findFirst({
      where: { githubUsername },
      select: {
        id: true,
        githubId: true,
        githubUsername: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getTeams(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        teamMembers: {
          include: {
            team: {
              include: {
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

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user.teamMembers.map((tm) => ({
      ...tm.team,
      role: tm.role,
      joinedAt: tm.joinedAt,
    }));
  }
}
