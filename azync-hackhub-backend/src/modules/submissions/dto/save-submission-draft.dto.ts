import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/** Drafts intentionally omit wallet/evidence: those are final-submit gates. */
export class SaveSubmissionDraftDto {
  @IsString() teamId: string;
  @IsString() hackathonId: string;
  @IsOptional() @IsString() trackId?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) projectName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUrl() githubUrl?: string;
  @IsOptional() @IsUrl() demoUrl?: string;
  @IsOptional() @IsUrl() videoUrl?: string;
  @IsOptional() @IsUrl() slidesUrl?: string;
  @IsOptional() @IsUrl() participantBlockchainEvidenceUrl?: string;
}
