import { ForbiddenException } from '@nestjs/common';
import { AccessPolicyService } from './access-policy.service';

describe('AccessPolicyService role matrix', () => {
  const prisma = {
    teamMember: { findUnique: jest.fn() },
    hackathon: { findUnique: jest.fn() },
    hackathonJudge: { findUnique: jest.fn() },
    submission: { findUnique: jest.fn() },
  } as any;
  const service = new AccessPolicyService(prisma);

  beforeEach(() => jest.clearAllMocks());

  const submissionFor = (memberIds: string[], organizerId = 'organizer') => ({
    id: 'submission', teamId: 'team', hackathonId: 'hackathon',
    team: { members: memberIds.map((userId) => ({ id: `${userId}-member` })) },
    hackathon: { organizerId },
  });

  it.each([
    ['member', submissionFor(['member']), false],
    ['organizer', submissionFor([]), false],
    ['judge', submissionFor([]), true],
  ])('allows submission read for current %s', async (role, submission, isJudge) => {
    prisma.submission.findUnique.mockResolvedValue(submission);
    jest.spyOn(service, 'isHackathonJudge').mockResolvedValue(isJudge as boolean);
    const userId = role === 'organizer' ? 'organizer' : role;

    await expect(service.requireSubmissionRead('submission', userId)).resolves.toEqual(submission);
  });

  it.each(['outsider', 'revoked-member', 'revoked-judge'])('denies submission read when caller is %s', async (userId) => {
    prisma.submission.findUnique.mockResolvedValue(submissionFor([]));
    jest.spyOn(service, 'isHackathonJudge').mockResolvedValue(false);

    await expect(service.requireSubmissionRead('submission', userId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows mint retry only for a current team member', async () => {
    prisma.submission.findUnique.mockResolvedValue({ id: 'submission', teamId: 'team', hackathonId: 'hackathon' });
    prisma.teamMember.findUnique.mockResolvedValue({ id: 'membership', role: 'member' });
    await expect(service.requireSubmissionMember('submission', 'member')).resolves.toEqual(expect.objectContaining({ id: 'submission' }));

    prisma.teamMember.findUnique.mockResolvedValue(null);
    await expect(service.requireSubmissionMember('submission', 'organizer')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.requireSubmissionMember('submission', 'judge')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['organizer', 'organizer', false, true],
    ['judge', 'organizer', true, true],
    ['participant', 'organizer', false, false],
    ['outsider', 'organizer', false, false],
    ['revoked-judge', 'organizer', false, false],
  ])('allows private hackathon room only for organizer/current judge (%s)', async (userId, organizerId, isJudge, allowed) => {
    prisma.hackathon.findUnique.mockResolvedValue({ organizerId });
    jest.spyOn(service, 'isHackathonJudge').mockResolvedValue(isJudge as boolean);
    const result = service.requireHackathonPrivateAccess('hackathon', userId);
    if (allowed) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing object IDs before querying Prisma', async () => {
    await expect(service.requireTeamMember('', 'user')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.requireSubmissionRead('', 'user')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.requireHackathonPrivateAccess('', 'user')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.teamMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
    expect(prisma.hackathon.findUnique).not.toHaveBeenCalled();
  });
});
