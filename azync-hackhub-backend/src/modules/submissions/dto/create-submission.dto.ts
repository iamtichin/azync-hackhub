import { IsString, IsUrl, IsOptional, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubmissionDto {
  @ApiProperty()
  @IsString()
  teamId: string;

  @ApiProperty()
  @IsString()
  hackathonId: string;

  @ApiProperty()
  @IsString()
  trackId: string;

  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  projectName: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  description: string;

  @ApiProperty({ required: false, description: 'Autofilled from the team repository when omitted; participants may override it.' })
  @IsUrl()
  @IsOptional()
  githubUrl: string;

  @ApiProperty()
  @IsUrl()
  demoUrl: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  videoUrl?: string;

  @ApiProperty()
  @IsUrl()
  slidesUrl: string;

  @ApiProperty({ description: 'Participant-provided blockchain proof URL, captured in the immutable final receipt.' })
  @IsUrl()
  participantBlockchainEvidenceUrl: string;

  @ApiProperty()
  @IsString()
  walletAddress: string;
}
