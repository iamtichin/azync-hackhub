import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const ORGANIZER_SUBMISSION_STATUSES = [
  'confirmed',
  'pending_nft',
  'nft_failed',
  'mint_pending_reconciliation',
] as const;

export class OrganizerSubmissionsQueryDto {
  @IsOptional() @IsString() @MaxLength(128) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsString() @MaxLength(128) trackId?: string;
  @IsOptional() @IsString() @IsIn(ORGANIZER_SUBMISSION_STATUSES) status?: string;
}

export class OrganizerSubmissionsCsvQueryDto {
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsString() @MaxLength(128) trackId?: string;
  @IsOptional() @IsString() @IsIn(ORGANIZER_SUBMISSION_STATUSES) status?: string;
}
