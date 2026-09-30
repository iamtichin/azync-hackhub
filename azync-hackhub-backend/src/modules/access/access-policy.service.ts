import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccessPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async requireTeamMember(teamId: string, userId: string) {
    if (!teamId || !userId) throw new ForbiddenException('Authentication and team ID are required');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('You are not a member of this team');
    return member;
  }

  async requireTeamAdmin(teamId: string, userId: string) {
    const member = await this.requireTeamMember(teamId, userId);
    if (member.role !== 'admin') throw new ForbiddenException('Only team admins can perform this action');
    return member;
  }

  async requireHackathonOrganizer(hackathonId: string, userId: string) {
    const hackathon = await this.prisma.hackathon.findUnique({
      where: { id: hackathonId }, select: { organizerId: true },
    });
    if (!hackathon) throw new NotFoundException('Hackathon not found');
    if (!hackathon.organizerId || hackathon.organizerId !== userId) {
      throw new ForbiddenException('Only the hackathon organizer may perform this action');
    }
  }

  async isHackathonJudge(hackathonId: string, userId: string) {
    if (!hackathonId || !userId) return false;
    return Boolean(await this.prisma.hackathonJudge.findUnique({
      where: { hackathonId_userId: { hackathonId, userId } }, select: { id: true },
    }));
  }

  async requireSubmissionRead(submissionId: string, userId: string) {
    if (!submissionId || !userId) throw new ForbiddenException('Authentication and submission ID are required');
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, teamId: true, hackathonId: true, team: { select: { members: { where: { userId }, select: { id: true } } } }, hackathon: { select: { organizerId: true } } },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.team.members.length || submission.hackathon.organizerId === userId || await this.isHackathonJudge(submission.hackathonId, userId)) return submission;
    throw new ForbiddenException('You are not allowed to access this submission');
  }

  async requireSubmissionMember(submissionId: string, userId: string) {
    if (!submissionId || !userId) throw new ForbiddenException('Authentication and submission ID are required');
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId }, select: { id: true, teamId: true, hackathonId: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.requireTeamMember(submission.teamId, userId);
    return submission;
  }

  async requireHackathonPrivateAccess(hackathonId: string, userId: string) {
    if (!hackathonId || !userId) throw new ForbiddenException('Authentication and hackathon ID are required');
    const hackathon = await this.prisma.hackathon.findUnique({ where: { id: hackathonId }, select: { organizerId: true } });
    if (!hackathon) throw new NotFoundException('Hackathon not found');
    if (hackathon.organizerId === userId || await this.isHackathonJudge(hackathonId, userId)) return;
    throw new ForbiddenException('You are not allowed to access this hackathon room');
  }

  async requirePublishedHackathon(hackathonId: string) {
    const hackathon = await this.prisma.hackathon.findUnique({ where: { id: hackathonId }, select: { isPublished: true } });
    if (!hackathon || hackathon.isPublished === false) throw new NotFoundException('Hackathon not found');
  }
}
