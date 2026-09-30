import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GithubTokenEncryptionService } from '../security/github-token-encryption.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private tokenEncryption: GithubTokenEncryptionService,
  ) {
    super({
      clientID: configService.get('GITHUB_CLIENT_ID'),
      clientSecret: configService.get('GITHUB_CLIENT_SECRET'),
      callbackURL: configService.get('GITHUB_CALLBACK_URL'),
      // Repository provisioning uses the server integration token; end-user login only needs identity.
      scope: ['read:user', 'user:email'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
  ): Promise<any> {
    const { id, username, displayName, emails, photos } = profile;

    // Find or create user
    let user = await this.prisma.user.findUnique({
      where: { githubId: id },
    });

    if (!user) {
      const userId = this.tokenEncryption.newUserId();
      user = await this.prisma.user.create({
        data: {
          id: userId,
          githubId: id,
          githubUsername: username,
          name: displayName || username,
          email: emails?.[0]?.value || null,
          avatarUrl: photos?.[0]?.value || null,
          ...this.tokenEncryption.encryptToken(userId, id, accessToken),
        },
      });
    } else {
      // Update access token and profile info
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          ...this.tokenEncryption.encryptToken(user.id, id, accessToken),
          name: displayName || username,
          email: emails?.[0]?.value || user.email,
          avatarUrl: photos?.[0]?.value || user.avatarUrl,
        },
      });
    }

    return user;
  }
}
