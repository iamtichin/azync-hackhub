import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GithubStrategy } from './strategies/github.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PrismaModule } from '../prisma/prisma.module';
import { GithubTokenEncryptionService } from './security/github-token-encryption.service';
import { AuthSessionService } from './security/auth-session.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: '7d',
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    GithubStrategy,
    JwtStrategy,
    GithubTokenEncryptionService,
    AuthSessionService,
  ],
  controllers: [AuthController],
  exports: [AuthService, AuthSessionService, JwtModule],
})
export class AuthModule {}
