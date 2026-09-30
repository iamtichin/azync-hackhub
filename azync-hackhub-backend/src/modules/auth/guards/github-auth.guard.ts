import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class GithubAuthGuard extends AuthGuard('github') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const expected = this.stateCookie(request.headers?.cookie);
    const received = request.query?.state;
    if (typeof received !== 'string' || !expected || !this.statesMatch(expected, received)) {
      return false;
    }

    // Consume valid state before Passport exchanges the authorization code.
    response.clearCookie('azync_oauth_state', { path: '/auth/github' });
    return super.canActivate(context);
  }

  private stateCookie(cookieHeader: unknown) {
    if (typeof cookieHeader !== 'string') return undefined;
    return cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith('azync_oauth_state='))?.slice('azync_oauth_state='.length);
  }

  private statesMatch(expected: string, received: string) {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  }
}
