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
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { CreateTeamDto, UpdateTeamDto, AddMemberDto, CreateTeamInviteDto } from './dto/team.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

@ApiTags('teams')
@Controller('teams')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new team' })
  create(@Body() createTeamDto: CreateTeamDto, @Req() req: any) {
    return this.teamsService.create(createTeamDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all teams' })
  @ApiQuery({ name: 'hackathonId', required: false })
  findAll(@Query('hackathonId') hackathonId?: string) {
    return this.teamsService.findAll(hackathonId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get team by ID' })
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.teamsService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update team (admin only)' })
  update(
    @Param('id') id: string,
    @Body() updateTeamDto: UpdateTeamDto,
    @Req() req: any,
  ) {
    return this.teamsService.update(id, updateTeamDto, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete team (admin only)' })
  remove(@Param('id') id: string, @Req() req: any) {
    return this.teamsService.remove(id, req.user.id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Get team members' })
  getMembers(@Param('id') id: string, @Req() req: any) {
    return this.teamsService.getMembers(id, req.user.id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add member to team (admin only)' })
  addMember(
    @Param('id') id: string,
    @Body() addMemberDto: AddMemberDto,
    @Req() req: any,
  ) {
    return this.teamsService.addMember(id, addMemberDto, req.user.id);
  }

  @Post(':id/invites')
  @ApiOperation({ summary: 'Create a one-time expiring team invite (admin only)' })
  createInvite(@Param('id') id: string, @Body() dto: CreateTeamInviteDto, @Req() req: any) {
    return this.teamsService.createInvite(id, dto, req.user.id);
  }

  @Post('invites/:code/join')
  @ApiOperation({ summary: 'Join a team with a valid one-time invite' })
  joinInvite(@Param('code') code: string, @Req() req: any) {
    return this.teamsService.joinInvite(code, req.user.id);
  }

  @Delete(':id/invites/:inviteId')
  @ApiOperation({ summary: 'Revoke a team invite (admin only)' })
  revokeInvite(@Param('id') id: string, @Param('inviteId') inviteId: string, @Req() req: any) {
    return this.teamsService.revokeInvite(id, inviteId, req.user.id);
  }

  @Get(':id/invites')
  @ApiOperation({ summary: 'List active team invites (admin only)' })
  listInvites(@Param('id') id: string, @Req() req: any) {
    return this.teamsService.listInvites(id, req.user.id);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove member from team (admin only or self)' })
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    return this.teamsService.removeMember(id, userId, req.user.id);
  }
}
