import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateSubmissionDto } from './create-submission.dto';

describe('CreateSubmissionDto HTTP validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const payload = {
    teamId: 'team',
    hackathonId: 'hackathon',
    trackId: 'track',
    projectName: 'Campus Return',
    description: 'A sufficiently detailed project description.',
    githubUrl: 'https://github.com/org/repository',
    demoUrl: 'https://example.com/walkthrough',
    slidesUrl: 'https://example.com/slides',
    participantBlockchainEvidenceUrl: 'https://explorer.solana.com/tx/signature?cluster=devnet',
    walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
  };

  it('accepts a final payload without the optional video walkthrough', async () => {
    await expect(pipe.transform(payload, { type: 'body', metatype: CreateSubmissionDto }))
      .resolves.toEqual(expect.objectContaining({ projectName: 'Campus Return', videoUrl: undefined }));
  });

  it('still rejects a malformed video URL when one is supplied', async () => {
    await expect(pipe.transform({ ...payload, videoUrl: 'not-a-url' }, { type: 'body', metatype: CreateSubmissionDto }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
