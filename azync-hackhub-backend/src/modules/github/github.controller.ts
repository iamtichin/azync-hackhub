import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { GithubService } from './github.service';
import { CreateRepoDto, AddCollaboratorDto } from './dto/github.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@ApiTags('github')
@Controller('github')
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly configService: ConfigService,
  ) {}

  @Post('create-repo')
  @SkipThrottle({ auth: true, mint: true, ai: true })
  @Throttle({ provision: { limit: 3, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create GitHub repository for team' })
  createRepository(@Body() createRepoDto: CreateRepoDto, @Req() req: any) {
    return this.githubService.createRepository(createRepoDto, req.user.id);
  }

  @Post(':teamId/add-collaborator')
  @SkipThrottle({ auth: true, mint: true, ai: true })
  @Throttle({ provision: { limit: 3, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add collaborator to team repository (admin only)' })
  addCollaborator(
    @Param('teamId') teamId: string,
    @Body() addCollaboratorDto: AddCollaboratorDto,
    @Req() req: any,
  ) {
    return this.githubService.addCollaborator(
      teamId,
      addCollaboratorDto,
      req.user.id,
    );
  }

  @Post(':teamId/sync-collaborators')
  @SkipThrottle({ auth: true, mint: true, ai: true })
  @Throttle({ provision: { limit: 3, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reconcile repository access with team and judge roster (admin only)' })
  syncCollaborators(@Param('teamId') teamId: string, @Req() req: any) {
    return this.githubService.refreshCollaborators(teamId, req.user.id);
  }

  @Post(':teamId/setup-webhook')
  @SkipThrottle({ auth: true, mint: true, ai: true })
  @Throttle({ provision: { limit: 3, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retry repository webhook setup (admin only)' })
  retryWebhook(@Param('teamId') teamId: string, @Req() req: any) {
    return this.githubService.retryWebhook(teamId, req.user.id);
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly githubService: GithubService,
    private readonly configService: ConfigService,
  ) {}

  @Post('github')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ auth: true, mint: true, ai: true, provision: true })
  @ApiOperation({ summary: 'GitHub webhook receiver' })
  async handleGithubWebhook(
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Headers('x-github-hook-id') hookId: string,
    @Req() request: RawBodyRequest<Request>,
    @Body() payload: any,
  ) {
    const webhookSecret = this.configService
      .get<string>('GITHUB_WEBHOOK_SECRET')
      ?.trim();
    if (!webhookSecret) {
      throw new ServiceUnavailableException(
        'GitHub webhook verification is not configured',
      );
    }
    if (!event || !deliveryId) {
      throw new BadRequestException(
        'Missing GitHub event or delivery identifier',
      );
    }
    if (!signature) {
      throw new UnauthorizedException('Missing GitHub webhook signature');
    }
    if (!request.rawBody) {
      throw new BadRequestException('Raw webhook body is unavailable');
    }

    const signatureMatch = /^sha256=([0-9a-f]{64})$/i.exec(signature);
    if (!signatureMatch) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }
    const expectedDigest = crypto
      .createHmac('sha256', webhookSecret)
      .update(request.rawBody)
      .digest();
    const suppliedDigest = Buffer.from(signatureMatch[1], 'hex');
    if (
      suppliedDigest.length !== expectedDigest.length ||
      !crypto.timingSafeEqual(suppliedDigest, expectedDigest)
    ) {
      throw new UnauthorizedException('Invalid GitHub webhook signature');
    }

    const payloadHash = crypto
      .createHash('sha256')
      .update(request.rawBody)
      .digest('hex');
    return this.githubService.handleWebhook({
      event,
      deliveryId,
      hookId: hookId || null,
      payloadHash,
      payload,
    });
  }
}
