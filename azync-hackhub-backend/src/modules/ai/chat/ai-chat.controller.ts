import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiChatService } from './ai-chat.service';
import { CreateAiChatSessionDto } from './dto/create-ai-chat-session.dto';
import { SendAiChatMessageDto } from './dto/send-ai-chat-message.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

type AuthenticatedRequest = { user: { id: string } };

@ApiTags('AI judge chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('submissions/:submissionId/ai-chat')
export class AiChatController {
  constructor(private readonly chat: AiChatService) {}

  @Post('sessions')
  @SkipThrottle({ auth: true, provision: true, mint: true })
  @Throttle({ ai: { limit: 12, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a judge-scoped chat session' })
  createSession(
    @Param('submissionId') submissionId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAiChatSessionDto,
  ) {
    return this.chat.createSession(submissionId, req.user.id, dto.title);
  }

  @Get('sessions')
  listSessions(
    @Param('submissionId') submissionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chat.listSessions(submissionId, req.user.id);
  }

  @Get('sessions/:sessionId/messages')
  listMessages(
    @Param('submissionId') submissionId: string,
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.chat.listMessages(submissionId, sessionId, req.user.id);
  }

  @Post('sessions/:sessionId/messages')
  @SkipThrottle({ auth: true, provision: true, mint: true })
  @Throttle({ ai: { limit: 12, ttl: 60000 } })
  @ApiOperation({
    summary: 'Ask about this submission in its hackathon context',
  })
  sendMessage(
    @Param('submissionId') submissionId: string,
    @Param('sessionId') sessionId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendAiChatMessageDto,
  ) {
    return this.chat.sendMessage(
      submissionId,
      sessionId,
      req.user.id,
      dto.content.trim(),
    );
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Get dynamic context-aware ghost suggestions' })
  suggestions(
    @Param('submissionId') submissionId: string,
    @Req() req: AuthenticatedRequest,
    @Query('prefix') prefix = '',
  ) {
    return this.chat.suggestions(submissionId, req.user.id, prefix);
  }
}
