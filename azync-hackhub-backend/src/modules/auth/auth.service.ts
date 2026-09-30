import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async login(user: User) {
    const payload = {
      sub: user.id,
      githubUsername: user.githubUsername,
    };

    return {
      access_token: this.jwtService.sign({ ...payload, jti: randomUUID() }),
      user: {
        id: user.id,
        githubUsername: user.githubUsername,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async validateUser(userId: string): Promise<User | null> {
    // This is handled by JWT strategy
    return null;
  }

  decode(token: string): { sub?: string; jti?: string; exp?: number } | null {
    return this.jwtService.decode(token) as { sub?: string; jti?: string; exp?: number } | null;
  }
}
