import {
  IsArray,
  IsBoolean,
  ArrayMaxSize,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class HackathonRuleDto {
  @IsString() @IsNotEmpty() @MaxLength(64) id: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) description: string;
}

export class RubricCriterionDto {
  @IsString() @IsNotEmpty() @MaxLength(64) id: string;
  @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) description: string;
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  weight: number;
  @IsInt() @Min(0) @Max(100) minScore: number;
  @IsInt() @Min(0) @Max(100) maxScore: number;
}

export class CreateHackathonDto {
  @ApiProperty({ example: 'UniHackFest 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsString() @IsOptional() @MaxLength(4000) description?: string;
  @IsString() @IsOptional() @MaxLength(2048) coverUrl?: string;

  @ApiProperty({ example: '2026-09-15T00:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ example: '2026-09-17T23:59:59Z' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @ApiPropertyOptional({ type: [HackathonRuleDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HackathonRuleDto)
  @IsOptional()
  rules?: HackathonRuleDto[];

  @ApiPropertyOptional({ type: [RubricCriterionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  @IsOptional()
  rubric?: RubricCriterionDto[];
}

export class UpdateHackathonDto {
  @ApiPropertyOptional({ example: 'UniHackFest 2026 - Updated' })
  @IsString()
  @IsOptional()
  @MaxLength(160)
  name?: string;

  @IsString() @IsOptional() @MaxLength(4000) description?: string;
  @IsString() @IsOptional() @MaxLength(2048) coverUrl?: string;
  @IsBoolean() @IsOptional() isPublished?: boolean;

  @ApiPropertyOptional({ example: '2026-09-15T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-17T23:59:59Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ type: [HackathonRuleDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => HackathonRuleDto)
  @IsOptional()
  rules?: HackathonRuleDto[];

  @ApiPropertyOptional({ type: [RubricCriterionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  @IsOptional()
  rubric?: RubricCriterionDto[];
}

export class RegisterTeamDto {
  @ApiProperty({ example: 'team-id-123' })
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @IsString() @IsOptional() trackId?: string;
}

export class CreateTrackDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name: string;
  @IsString() @IsOptional() @MaxLength(4000) description?: string;
}

export class UpdateTrackDto {
  @IsString() @IsOptional() @MaxLength(160) name?: string;
  @IsString() @IsOptional() @MaxLength(4000) description?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

export class AssignJudgeDto {
  @ApiProperty({ description: 'Existing user ID to assign as a judge' })
  @IsString()
  @IsNotEmpty()
  userId: string;
}

export class SelectWinnerDto {
  @ApiProperty({ description: 'Final submission selected by the organizer' })
  @IsString()
  @IsNotEmpty()
  submissionId: string;
}
