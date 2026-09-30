import { IsString, IsNotEmpty, IsArray, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRepoDto {
  @ApiProperty({ example: 'team-id-123' })
  @IsString()
  @IsNotEmpty()
  teamId: string;

  @ApiPropertyOptional({ example: 'My Hackathon Project' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: ['javascript', 'react', 'nextjs'] })
  @IsArray()
  @IsOptional()
  topics?: string[];
}

export class AddCollaboratorDto {
  @ApiProperty({ example: 'github-username' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiPropertyOptional({ example: 'push', enum: ['pull', 'push'] })
  @IsString()
  @IsOptional()
  @IsIn(['pull', 'push'])
  permission?: 'pull' | 'push';
}
