import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendAiChatMessageDto {
  @ApiProperty({ minLength: 2, maxLength: 4000 })
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  content: string;
}
