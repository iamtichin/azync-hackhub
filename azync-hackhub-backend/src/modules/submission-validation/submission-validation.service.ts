import { BadRequestException, ForbiddenException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SUBMISSION_ADVISORY_PROVIDER, SUBMISSION_REPOSITORY_INSPECTOR, type SubmissionAdvisoryProvider, type SubmissionRepositoryInspector } from './submission-validation.token';

type Status = 'PASS' | 'FAIL' | 'UNCERTAIN';
type Check = { code: string; status: Status; summary: string; evidence: string[] };

const text = (payload: any, key: string) => typeof payload?.[key] === 'string' && payload[key].trim() ? payload[key].trim() : null;
function stable(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

@Injectable()
export class SubmissionValidationService {
  private readonly lastRun = new Map<string, number>();
  private readonly retryAfterMs = 15_000;

  constructor(private readonly prisma: PrismaService, @Inject(SUBMISSION_REPOSITORY_INSPECTOR) private readonly inspector: SubmissionRepositoryInspector, @Inject(SUBMISSION_ADVISORY_PROVIDER) private readonly advisoryProvider: SubmissionAdvisoryProvider) {}

  async validateDraft(input: { teamId: string; hackathonId: string; draftRevision: string }, userId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: input.teamId }, include: { members: true, repository: true } });
    if (!team || team.hackathonId !== input.hackathonId) throw new NotFoundException('Team not found');
    if (!team.members.some((member: any) => member.userId === userId)) throw new ForbiddenException('You are not a member of this team');
    const draft = await this.prisma.submissionDraft.findUnique({ where: { teamId_hackathonId: { teamId: input.teamId, hackathonId: input.hackathonId } } });
    if (!draft) throw new BadRequestException('Save a draft before requesting validation');
    const revision = new Date(draft.updatedAt).toISOString();
    if (revision !== new Date(input.draftRevision).toISOString()) throw new BadRequestException('Draft changed after this validation request; save and validate the current revision');
    const rateKey = `${userId}:${input.teamId}:${input.hackathonId}`;
    const now = Date.now();
    const previous = this.lastRun.get(rateKey);
    if (previous && now - previous < this.retryAfterMs) throw new ThrottlerException(`Validation can be rerun in ${Math.ceil((this.retryAfterMs - now + previous) / 1000)} seconds`);
    this.lastRun.set(rateKey, now);

    const [hackathon, registration] = await Promise.all([
      this.prisma.hackathon.findUnique({ where: { id: input.hackathonId } }),
      this.prisma.hackathonRegistration.findUnique({ where: { hackathonId_teamId: { hackathonId: input.hackathonId, teamId: input.teamId } } }),
    ]);
    if (!hackathon || !registration) throw new BadRequestException('Team is not registered for this hackathon');
    const payload: any = draft.payload;
    const fingerprint = createHash('sha256').update(`${revision}\n${stable(payload)}`).digest('hex');
    const checks: Check[] = [];
    const name = text(payload, 'projectName');
    const description = text(payload, 'description');
    const githubUrl = text(payload, 'githubUrl');
    checks.push({ code: 'base.project_name', status: name && name.length >= 3 ? 'PASS' : 'FAIL', summary: name ? 'Project name is present.' : 'Project name is required.', evidence: ['Saved draft field: projectName'] });
    checks.push({ code: 'base.description', status: description && description.length >= 10 ? 'PASS' : 'FAIL', summary: description ? 'Project description is present.' : 'Project description is required.', evidence: ['Saved draft field: description'] });
    const activeTracks = await this.prisma.track.findMany({ where: { hackathonId: input.hackathonId, isActive: true }, select: { id: true } });
    const trackId = text(payload, 'trackId') ?? registration.trackId ?? null;
    const track = trackId ? await this.prisma.track.findFirst({ where: { id: trackId, hackathonId: input.hackathonId, isActive: true } }) : null;
    checks.push({ code: 'track.required', status: activeTracks.length === 0 || track ? 'PASS' : 'FAIL', summary: activeTracks.length === 0 ? 'This hackathon has no active tracks.' : track ? 'An active hackathon track is selected.' : 'Select an active track before final submission.', evidence: [track ? `Track ${track.id} is active for this hackathon.` : activeTracks.length === 0 ? 'No active track-specific requirement exists.' : 'Saved draft/registration has no active track.'] });
    try {
      const inspected = await this.inspector.inspect({ repository: team.repository, githubUrl });
      checks.push({ code: 'repository.access', status: inspected.accessible === true ? 'PASS' : inspected.accessible === false ? 'FAIL' : 'UNCERTAIN', summary: inspected.accessible === true ? 'Repository access metadata is available.' : inspected.accessible === false ? 'Repository is not accessible to the validator.' : 'Repository access cannot be proven locally.', evidence: [inspected.evidence] });
      checks.push({ code: 'repository.readme', status: inspected.readme === true ? 'PASS' : inspected.readme === false ? 'FAIL' : 'UNCERTAIN', summary: inspected.readme === true ? 'README was found.' : inspected.readme === false ? 'README is missing.' : 'README presence cannot be proven locally.', evidence: [inspected.evidence] });
    } catch {
      checks.push({ code: 'repository.access', status: 'UNCERTAIN', summary: 'Repository provider is unavailable.', evidence: ['Local repository inspector failed; retry later.'] });
      checks.push({ code: 'repository.readme', status: 'UNCERTAIN', summary: 'README could not be checked.', evidence: ['Local repository inspector failed; retry later.'] });
    }
    checks.push(this.demoCheck(text(payload, 'demoUrl')));
    let advisory: { kind: 'AI_ADVISORY'; status: Status; message: string; evidence: string[] };
    try {
      advisory = { kind: 'AI_ADVISORY', status: 'PASS', message: await this.advisoryProvider.advise({ projectName: name, description }), evidence: ['AI feedback is advisory only and does not change mandatory check outcomes.'] };
    } catch {
      advisory = { kind: 'AI_ADVISORY', status: 'UNCERTAIN', message: 'AI advisory provider is unavailable; mandatory checks remain available.', evidence: ['Provider failure is non-blocking. Draft text was not executed as instructions.'] };
    }
    return { draftRevision: revision, fingerprint, staleWarning: 'Editing the draft changes its revision and makes this validation stale.', checks, advisory, rateLimit: { retryAfterSeconds: 15 } };
  }

  private demoCheck(value: string | null): Check {
    if (!value) return { code: 'demo.url_semantics', status: 'FAIL', summary: 'A demo URL is required.', evidence: ['Saved draft field: demoUrl'] };
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/i.test(url.hostname) || url.username || url.password) throw new Error('unsafe');
      return { code: 'demo.url_semantics', status: 'PASS', summary: 'Demo URL has acceptable HTTPS semantics.', evidence: ['URL syntax and public-host policy were checked locally.', 'PASS means a syntactically acceptable URL only; it does not claim the demo is fully working.'] };
    } catch { return { code: 'demo.url_semantics', status: 'FAIL', summary: 'Demo URL must be a public HTTPS URL without credentials.', evidence: ['Saved draft field: demoUrl'] }; }
  }
}
