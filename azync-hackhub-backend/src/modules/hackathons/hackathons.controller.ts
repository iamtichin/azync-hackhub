import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { HackathonsService } from './hackathons.service';
import {
  CreateHackathonDto,
  UpdateHackathonDto,
  RegisterTeamDto,
  AssignJudgeDto,
  CreateTrackDto,
  UpdateTrackDto,
  SelectWinnerDto,
} from './dto/hackathon.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  OrganizerSubmissionsCsvQueryDto,
  OrganizerSubmissionsQueryDto,
} from './dto/organizer-submissions-query.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

@ApiTags('hackathons')
@Controller('hackathons')
export class HackathonsController {
  constructor(private readonly hackathonsService: HackathonsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new hackathon (organizer)' })
  create(@Body() createHackathonDto: CreateHackathonDto, @Req() req: any) {
    return this.hackathonsService.create(createHackathonDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all hackathons' })
  @ApiQuery({ name: 'includeEnded', required: false, type: Boolean })
  findAll(@Query('includeEnded') includeEnded?: string) {
    const includeEndedBool = includeEnded === 'true';
    return this.hackathonsService.findAll(includeEndedBool);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  findOwned(@Req() req: any) {
    return this.hackathonsService.findOwned(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get hackathon by ID' })
  findOne(@Param('id') id: string) {
    return this.hackathonsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update hackathon (organizer)' })
  update(
    @Param('id') id: string,
    @Body() updateHackathonDto: UpdateHackathonDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.update(id, updateHackathonDto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete hackathon (organizer)' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.hackathonsService.remove(id, req.user.id);
  }

  @Post(':id/judges')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a judge (organizer)' })
  assignJudge(
    @Param('id') id: string,
    @Body() dto: AssignJudgeDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.assignJudge(id, dto, req.user.id);
  }

  @Get(':id/judges')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List assigned judges (organizer)' })
  listJudges(@Param('id') id: string, @Req() req: any) {
    return this.hackathonsService.listJudges(id, req.user.id);
  }

  @Delete(':id/judges/:userId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a judge assignment (organizer)' })
  removeJudge(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    return this.hackathonsService.removeJudge(id, userId, req.user.id);
  }

  @Post(':id/register')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register team for hackathon' })
  registerTeam(
    @Param('id') id: string,
    @Body() registerTeamDto: RegisterTeamDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.registerTeam(
      id,
      registerTeamDto,
      req.user.id,
    );
  }

  @Get(':id/tracks')
  @ApiOperation({ summary: 'List active published tracks' })
  listTracks(@Param('id') id: string) {
    return this.hackathonsService.listTracks(id);
  }

  @Post(':id/tracks')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createTrack(
    @Param('id') id: string,
    @Body() dto: CreateTrackDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.createTrack(id, dto, req.user.id);
  }

  @Patch(':id/tracks/:trackId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updateTrack(
    @Param('id') id: string,
    @Param('trackId') trackId: string,
    @Body() dto: UpdateTrackDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.updateTrack(id, trackId, dto, req.user.id);
  }

  @Get(':id/teams')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get registered teams for hackathon' })
  getRegisteredTeams(@Param('id') id: string, @Req() req: any) {
    return this.hackathonsService.getRegisteredTeams(id, req.user.id);
  }

  @Get(':id/submissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all submissions for hackathon' })
  getSubmissions(@Param('id') id: string, @Req() req: any) {
    return this.hackathonsService.getSubmissions(id, req.user.id);
  }

  @Get(':id/organizer-submissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listOrganizerSubmissions(
    @Param('id') id: string,
    @Query() query: OrganizerSubmissionsQueryDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.listOrganizerSubmissions(
      id,
      req.user.id,
      query,
    );
  }

  @Get(':id/organizer-submissions.csv')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async exportOrganizerSubmissions(
    @Param('id') id: string,
    @Query() query: OrganizerSubmissionsCsvQueryDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const csv = await this.hackathonsService.exportOrganizerSubmissionsCsv(
      id,
      req.user.id,
      query,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${id}-submissions.csv"`,
    );
    res.send(csv);
  }

  @Post(':id/winner')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ mint: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Select the final winner and issue its Solana cNFT certificate',
  })
  selectWinner(
    @Param('id') id: string,
    @Body() dto: SelectWinnerDto,
    @Req() req: any,
  ) {
    return this.hackathonsService.selectWinner(
      id,
      dto.submissionId,
      req.user.id,
    );
  }

  @Post(':id/winner/retry-certificate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ mint: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Reconcile or retry the selected winner certificate',
  })
  retryWinnerCertificate(@Param('id') id: string, @Req() req: any) {
    return this.hackathonsService.retryWinnerCertificate(id, req.user.id);
  }

  @Get(':id/leaderboard')
  @ApiOperation({ summary: 'Get real-time leaderboard for hackathon' })
  getLeaderboard(@Param('id') id: string) {
    return this.hackathonsService.getLeaderboard(id);
  }
}
