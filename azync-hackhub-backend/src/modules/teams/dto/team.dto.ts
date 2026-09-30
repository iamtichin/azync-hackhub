import { IsString, IsNotEmpty, IsOptional, IsInt, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTeamDto {
  @ApiProperty({ example: 'Team Alpha' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'hackathon-id-123' })
  @IsString()
  @IsNotEmpty()
  hackathonId: string;

  @ApiPropertyOptional({ example: 'SolanaWalletAddress123' })
  @IsString()
  @IsOptional()
  walletAddress?: string;
}

export class UpdateTeamDto {
  @ApiPropertyOptional({ example: 'Team Beta' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'SolanaWalletAddress456' })
  @IsString()
  @IsOptional()
  walletAddress?: string;
}

export class AddMemberDto {
  @ApiProperty({ example: 'user-id-123' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiPropertyOptional({ example: 'member', enum: ['admin', 'member'] })
  @IsString()
  @IsOptional()
  role?: string;
}

export class CreateTeamInviteDto {
  @ApiPropertyOptional({ example: 24, minimum: 1, maximum: 168 })
  @IsInt()
  @Min(1)
  @Max(168)
  @IsOptional()
  expiresInHours?: number;
}
