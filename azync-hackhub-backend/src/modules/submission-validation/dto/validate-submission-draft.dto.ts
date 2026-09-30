import { IsISO8601, IsString } from 'class-validator';

export class ValidateSubmissionDraftDto {
  @IsString() teamId: string;
  @IsString() hackathonId: string;
  @IsISO8601() draftRevision: string;
}
