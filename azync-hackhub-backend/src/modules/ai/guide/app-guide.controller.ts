import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AzyncBotService } from './app-guide.service';
import { AskAppGuideDto } from './dto/ask-app-guide.dto';

type AuthenticatedRequest = { user: { id: string } };

@ApiTags('Azync-Bot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-bot')
export class AzyncBotController {
  constructor(private readonly bot: AzyncBotService) {}

  @Get('suggestions')
  @ApiOperation({ summary: 'Get starter questions for Azync-Bot' })
  suggestions() {
    return this.bot.suggestions();
  }

  @Post('messages')
  @ApiOperation({ summary: 'Ask the Azync-Bot product assistant' })
  ask(@Req() req: AuthenticatedRequest, @Body() dto: AskAppGuideDto) {
    return this.bot.ask(req.user.id, dto.content.trim(), dto.recentMessages);
  }
}
