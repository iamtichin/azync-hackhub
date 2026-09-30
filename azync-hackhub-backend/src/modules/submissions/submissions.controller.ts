import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SaveSubmissionDraftDto } from './dto/save-submission-draft.dto';
import { SubmissionResponseDto } from './dto/submission-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('submissions')
@Controller('submissions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post()
  @SkipThrottle({ auth: true, provision: true, ai: true })
  @Throttle({ mint: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Create submission, mint NFT, and queue AI analysis',
  })
  @ApiResponse({ status: 201, type: SubmissionResponseDto })
  async create(@Body() dto: CreateSubmissionDto, @Req() req: any) {
    return this.submissionsService.create(dto, req.user.id);
  }

  @Post('draft')
  @ApiOperation({ summary: 'Save an editable submission draft; wallet proof is required only at final submit' })
  saveDraft(@Body() dto: SaveSubmissionDraftDto, @Req() req: any) {
    return this.submissionsService.saveDraft(dto, req.user.id);
  }

  @Get('draft')
  @ApiOperation({ summary: 'Load a team submission draft with editable repository default' })
  getDraft(@Query('teamId') teamId: string, @Query('hackathonId') hackathonId: string, @Req() req: any) {
    return this.submissionsService.getDraft(teamId, hackathonId, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get submission by ID with NFT details' })
  @ApiResponse({ status: 200 })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.submissionsService.findOne(id, req.user.id);
  }

  @Get(':id/ai-analysis')
  // Status is safely polled by clients while a job runs; retain the default
  // request limit without charging it to action-specific mint/AI buckets.
  @SkipThrottle({ auth: true, provision: true, mint: true, ai: true })
  @ApiOperation({ summary: 'Get AI analysis status and results' })
  @ApiResponse({
    status: 200,
    description:
      'Returns not_queued, queued, processing, retrying, completed, failed, or not_found',
  })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async getAiAnalysisStatus(@Param('id') id: string, @Req() req: any) {
    return this.submissionsService.getAiAnalysisStatus(id, req.user.id);
  }

  @Post(':id/ai-analysis/refresh')
  @SkipThrottle({ auth: true, provision: true, mint: true })
  @Throttle({ ai: { limit: 12, ttl: 60000 } })
  @ApiOperation({
    summary: 'Refresh AI analysis only when submission context changed',
  })
  @ApiResponse({ status: 200, description: 'Returns queued or completed' })
  async refreshAiAnalysis(@Param('id') id: string, @Req() req: any) {
    return this.submissionsService.refreshAiAnalysis(id, req.user.id);
  }

  @Post(':id/retry-mint')
  @SkipThrottle({ auth: true, provision: true, ai: true })
  @Throttle({ mint: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Retry NFT minting for failed submissions' })
  @ApiResponse({ status: 200 })
  async retryMint(@Param('id') id: string, @Req() req: any) {
    return this.submissionsService.retryMint(id, req.user.id);
  }
}
