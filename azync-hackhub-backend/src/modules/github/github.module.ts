import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubController, WebhooksController } from './github.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { GITHUB_ROSTER_SYNC } from './github-roster-sync.token';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [GithubController, WebhooksController],
  providers: [GithubService, { provide: GITHUB_ROSTER_SYNC, useExisting: GithubService }],
  exports: [GithubService, GITHUB_ROSTER_SYNC],
})
export class GithubModule {}
