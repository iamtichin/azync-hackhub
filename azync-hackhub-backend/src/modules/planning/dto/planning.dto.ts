import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAreaDto {
  @ApiProperty({ example: 'Backend' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '#3B82F6' })
  @IsString()
  @IsNotEmpty()
  color: string;

  @ApiPropertyOptional({ example: 20 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedHours?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsNumber()
  @IsOptional()
  displayOrder?: number;
}

export class UpdateAreaDto {
  @ApiPropertyOptional({ example: 'Backend APIs' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: '#10B981' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ example: 25 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedHours?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  displayOrder?: number;
}

export class CreateTaskDto {
  @ApiProperty({ example: 'Setup database schema' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'Create Prisma schema with all models' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'area-id-123' })
  @IsString()
  @IsOptional()
  areaId?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedHours?: number;

  @ApiPropertyOptional({ example: 'high', enum: ['high', 'medium', 'low'] })
  @IsEnum(['high', 'medium', 'low'])
  @IsOptional()
  priority?: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({ example: 'user-id-123' })
  @IsString()
  @IsOptional()
  assigneeId?: string;
}

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Setup database schema - Updated' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'area-id-456' })
  @IsString()
  @IsOptional()
  areaId?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedHours?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  actualHours?: number;

  @ApiPropertyOptional({ example: 'in_progress', enum: ['backlog', 'todo', 'in_progress', 'blocked', 'done'] })
  @IsEnum(['backlog', 'todo', 'in_progress', 'blocked', 'done'])
  @IsOptional()
  status?: 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';

  @ApiPropertyOptional({ example: 'medium', enum: ['high', 'medium', 'low'] })
  @IsEnum(['high', 'medium', 'low'])
  @IsOptional()
  priority?: 'high' | 'medium' | 'low';

  @ApiPropertyOptional({ example: 'user-id-456' })
  @IsString()
  @IsOptional()
  assigneeId?: string | null;
}

export class AddDependencyDto {
  @ApiProperty({ example: 'task-id-123' })
  @IsString()
  @IsNotEmpty()
  dependsOnId: string;
}

export class ApplyPlanningTemplateDto {
  @ApiProperty({ enum: ['web3', 'ai', 'fullstack'] })
  @IsEnum(['web3', 'ai', 'fullstack'])
  templateId: 'web3' | 'ai' | 'fullstack';
}
