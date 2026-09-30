import { GithubAuthGuard } from './github-auth.guard';

describe('GithubAuthGuard', () => {
  const context = (state: unknown, cookie?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({ query: { state }, headers: { cookie } }),
      getResponse: () => ({ clearCookie: jest.fn() }),
    }),
  }) as any;

  it('rejects a mismatched OAuth state before Passport can exchange a code', async () => {
    const passportCanActivate = jest.spyOn(Object.getPrototypeOf(GithubAuthGuard.prototype), 'canActivate');
    const guard = new GithubAuthGuard();

    expect(guard.canActivate(context('attacker-state', 'azync_oauth_state=expected-state'))).toBe(false);
    expect(passportCanActivate).not.toHaveBeenCalled();
    passportCanActivate.mockRestore();
  });
});
