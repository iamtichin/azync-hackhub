import { Controller, Get, Patch, Body, Param, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getCurrentUser(@Req() req: any) {
    return this.usersService.findOne(req.user.id, true);
  }

  @Patch('me')
  updateCurrentUser(@Req() req: any, @Body() body: UpdateProfileDto) { return this.usersService.updateProfile(req.user.id, body); }

  @Get('me/teams')
  @ApiOperation({ summary: 'Get current user teams' })
  async getCurrentUserTeams(@Req() req: any) {
    return this.usersService.getTeams(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  async getUser(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Get(':id/teams')
  @ApiOperation({ summary: 'Get user teams' })
  async getUserTeams(@Param('id') id: string, @Req() req: any) {
    if (id !== req.user.id) throw new ForbiddenException('Team memberships are private');
    return this.usersService.getTeams(id);
  }
}
