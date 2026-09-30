import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AppGuideHistoryMessageDto {
  @IsIn(['USER', 'ASSISTANT'])
  role: 'USER' | 'ASSISTANT';

  @IsString()
  @MinLength(1)
  @MaxLength(6000)
  content: string;
}

export class AskAppGuideDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AppGuideHistoryMessageDto)
  recentMessages?: AppGuideHistoryMessageDto[];
}
