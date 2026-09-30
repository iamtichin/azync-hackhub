import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SaveSubmissionDraftDto } from './save-submission-draft.dto';

describe('SaveSubmissionDraftDto HTTP validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  it('rejects unknown draft fields rather than persisting arbitrary JSON', async () => {
    try {
      await pipe.transform({ teamId: 'team', hackathonId: 'hack', injected: 'nope' }, { type: 'body', metatype: SaveSubmissionDraftDto });
      fail('ValidationPipe accepted an unknown draft field');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(expect.objectContaining({
        message: expect.arrayContaining(['property injected should not exist']),
      }));
    }
  });

  it('rejects oversized draft text and malformed draft URLs', async () => {
    await expect(pipe.transform({ teamId: 'team', hackathonId: 'hack', description: 'x'.repeat(501), githubUrl: 'not-url' }, { type: 'body', metatype: SaveSubmissionDraftDto })).rejects.toThrow();
  });
});
