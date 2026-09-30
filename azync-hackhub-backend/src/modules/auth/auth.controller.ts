import { Controller, Get, Post, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import { AuthSessionService } from './security/auth-session.service';
import { EventsGateway } from '../../events/events.gateway';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
    private sessions: AuthSessionService,
    private events: EventsGateway,
  ) {}

  @Get('github')
  @SkipThrottle({ provision: true, mint: true, ai: true })
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Initiate GitHub OAuth flow' })
  async githubLogin(@Res() response: Response) {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const callbackUrl = this.configService.get<string>('GITHUB_CALLBACK_URL');
    if (!clientId || !callbackUrl) throw new UnauthorizedException('GitHub login is not configured');
    const state = randomBytes(32).toString('base64url');
    const redirect = new URL('https://github.com/login/oauth/authorize');
    redirect.searchParams.set('client_id', clientId);
    redirect.searchParams.set('redirect_uri', callbackUrl);
    redirect.searchParams.set('scope', 'read:user user:email');
    redirect.searchParams.set('state', state);
    response.cookie('azync_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/auth/github' });
    return response.redirect(redirect.toString());
  }

  @Get('github/callback')
  @SkipThrottle({ provision: true, mint: true, ai: true })
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @UseGuards(GithubAuthGuard)
  @ApiOperation({ summary: 'GitHub OAuth callback' })
  async githubCallback(@Req() req: any, @Res() response: Response) {
    const session = await this.authService.login(req.user);
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    if (!frontendUrl) return response.json(session);

    const callback = new URL('/auth/callback', frontendUrl);
    callback.hash = `access_token=${encodeURIComponent(session.access_token)}`;
    return response.redirect(callback.toString());
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@Req() req: any) {
    return req.user;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Req() req: any) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const decoded = token ? this.authService.decode(token) : null;
    if (decoded?.sub !== req.user.id) throw new UnauthorizedException('Invalid session');
    await this.sessions.revoke(decoded?.jti, req.user.id, decoded?.exp ? decoded.exp * 1000 : undefined);
    this.events.disconnectSession(decoded?.jti);
    return { message: 'Logged out successfully' };
  }
}
