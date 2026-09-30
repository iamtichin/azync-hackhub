import { EventsGateway } from './events.gateway';

describe('EventsGateway authorization', () => {
  const jwt = { verifyAsync: jest.fn() };
  const access = { requireTeamMember: jest.fn(), requireHackathonPrivateAccess: jest.fn(), requirePublishedHackathon: jest.fn() };
  const sessions = { assertActive: jest.fn() };
  const gateway = new EventsGateway(jwt as any, access as any, sessions as any);

  beforeEach(() => jest.clearAllMocks());

  it('authenticates a valid connection, permits its team join, and delivers a protected event', async () => {
    const socket = {
      id: 'socket-1', handshake: { auth: { token: 'Bearer token' }, headers: {} }, data: {},
      emit: jest.fn(), disconnect: jest.fn(), join: jest.fn(), leave: jest.fn(),
    };
    jwt.verifyAsync.mockResolvedValue({ sub: 'member', jti: 'jti-1', exp: 0 });
    sessions.assertActive.mockResolvedValue(undefined);
    access.requireTeamMember.mockResolvedValue({ id: 'membership' });
    await gateway.handleConnection(socket as any);
    await expect(gateway.handleJoinTeam(socket as any, 'team')).resolves.toEqual({ event: 'joined:team', data: 'team' });
    (gateway as any).server = { in: () => ({ fetchSockets: jest.fn().mockResolvedValue([socket]) }) };

    await gateway.emitToTeam('team', 'team:private-update', { safe: true });

    expect(socket.data).toEqual(expect.objectContaining({ userId: 'member', jti: 'jti-1', token: 'token' }));
    expect(socket.join).toHaveBeenCalledWith('team:team');
    expect(socket.emit).toHaveBeenCalledWith('team:private-update', { safe: true });
  });

  it('rejects anonymous or expired-token connections', async () => {
    const anonymous = { handshake: { auth: {}, headers: {} }, data: {}, emit: jest.fn(), disconnect: jest.fn() };
    await gateway.handleConnection(anonymous as any);
    expect(anonymous.disconnect).toHaveBeenCalledWith(true);

    const expired = { handshake: { auth: { token: 'expired' }, headers: {} }, data: {}, emit: jest.fn(), disconnect: jest.fn() };
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await gateway.handleConnection(expired as any);
    expect(expired.disconnect).toHaveBeenCalledWith(true);
  });

  it('denies an outsider from private team and hackathon rooms', async () => {
    const socket = { data: { token: 'token', userId: 'outsider', jti: 'jti' }, join: jest.fn() };
    jwt.verifyAsync.mockResolvedValue({ sub: 'outsider', jti: 'jti' });
    sessions.assertActive.mockResolvedValue(undefined);
    access.requireTeamMember.mockRejectedValue(new Error('not member'));
    access.requireHackathonPrivateAccess.mockRejectedValue(new Error('not judge'));

    await expect(gateway.handleJoinTeam(socket as any, 'team')).resolves.toEqual(expect.objectContaining({ event: 'join:error' }));
    await expect(gateway.handleJoinHackathon(socket as any, 'hackathon')).resolves.toEqual(expect.objectContaining({ event: 'join:error' }));
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('denies public leaderboard room access for a known unpublished hackathon', async () => {
    const socket = { data: { token: 'token', userId: 'viewer', jti: 'jti' }, join: jest.fn() };
    jwt.verifyAsync.mockResolvedValue({ sub: 'viewer', jti: 'jti' });
    sessions.assertActive.mockResolvedValue(undefined);
    access.requirePublishedHackathon = jest.fn().mockRejectedValue(new Error('draft'));

    await expect(gateway.handleJoinLeaderboard(socket as any, 'draft')).resolves.toEqual({
      event: 'join:error', data: { resource: 'leaderboard', message: 'Access denied' },
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('waits for connection authentication when a leaderboard join arrives immediately', async () => {
    let finishVerification!: (payload: { sub: string; jti: string; exp: number }) => void;
    const verification = new Promise<{ sub: string; jti: string; exp: number }>((resolve) => {
      finishVerification = resolve;
    });
    const socket = {
      id: 'immediate-join', connected: true,
      handshake: { auth: { token: 'token' }, headers: {} }, data: {},
      emit: jest.fn(), disconnect: jest.fn(), join: jest.fn(),
    };
    jwt.verifyAsync.mockImplementationOnce(() => verification)
      .mockResolvedValue({ sub: 'viewer', jti: 'jti', exp: 0 });
    sessions.assertActive.mockResolvedValue(undefined);
    access.requirePublishedHackathon.mockResolvedValue(undefined);

    const connecting = gateway.handleConnection(socket as any);
    const joining = gateway.handleJoinLeaderboard(socket as any, 'published');
    expect(socket.join).not.toHaveBeenCalled();
    finishVerification({ sub: 'viewer', jti: 'jti', exp: 0 });
    await connecting;
    await expect(joining).resolves.toEqual({ event: 'joined:leaderboard', data: 'published' });
    expect(socket.join).toHaveBeenCalledWith('hackathon:public:published');
    expect(sessions.assertActive).toHaveBeenCalledTimes(2);
  });

  it('denies an immediate join when connection authentication finds a revoked session', async () => {
    let finishVerification!: (payload: { sub: string; jti: string; exp: number }) => void;
    const verification = new Promise<{ sub: string; jti: string; exp: number }>((resolve) => {
      finishVerification = resolve;
    });
    const socket = {
      id: 'revoked-immediate-join', connected: true,
      handshake: { auth: { token: 'token' }, headers: {} }, data: {},
      emit: jest.fn(), disconnect: jest.fn(), join: jest.fn(),
    };
    jwt.verifyAsync.mockImplementationOnce(() => verification);
    sessions.assertActive.mockRejectedValue(new Error('revoked'));

    const connecting = gateway.handleConnection(socket as any);
    const joining = gateway.handleJoinLeaderboard(socket as any, 'published');
    finishVerification({ sub: 'viewer', jti: 'revoked', exp: 0 });
    await connecting;
    await expect(joining).resolves.toEqual({
      event: 'join:error', data: { resource: 'leaderboard', message: 'Access denied' },
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects a reconnect when the session or membership has been revoked', async () => {
    const socket = { handshake: { auth: { token: 'token' }, headers: {} }, data: {} as Record<string, unknown>, emit: jest.fn(), disconnect: jest.fn() };
    jwt.verifyAsync.mockResolvedValue({ sub: 'member', jti: 'revoked', exp: 0 });
    sessions.assertActive.mockRejectedValue(new Error('revoked'));

    await gateway.handleConnection(socket as any);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.data.userId).toBeUndefined();
  });

  it('clears an expiry timer when a socket disconnects early', async () => {
    jest.useFakeTimers();
    const socket = {
      id: 'socket-with-expiry', handshake: { auth: { token: 'token' }, headers: {} }, data: {} as Record<string, unknown>,
      emit: jest.fn(), disconnect: jest.fn(),
    };
    jwt.verifyAsync.mockResolvedValue({ sub: 'member', jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 60 });
    sessions.assertActive.mockResolvedValue(undefined);
    const clearTimer = jest.spyOn(global, 'clearTimeout');

    await gateway.handleConnection(socket as any);
    gateway.handleDisconnect(socket as any);

    expect(socket.data.expiryTimer).toBeDefined();
    expect(clearTimer).toHaveBeenCalledWith(socket.data.expiryTimer);
    clearTimer.mockRestore();
    jest.useRealTimers();
  });

  it('contains adapter-level delivery failures for fire-and-forget callers', async () => {
    (gateway as any).server = { in: () => { throw new Error('adapter unavailable'); } };
    await expect(gateway.emitToTeam('team', 'event', {})).resolves.toBeUndefined();
  });

  it('does not deliver protected events after session revocation', async () => {
    const socket = { data: { token: 'token', userId: 'user-1', jti: 'jti-1' }, emit: jest.fn(), leave: jest.fn(), disconnect: jest.fn() };
    (gateway as any).server = { in: () => ({ fetchSockets: jest.fn().mockResolvedValue([socket]) }) };
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'jti-1' });
    sessions.assertActive.mockRejectedValue(new Error('revoked'));

    await (gateway as any).emitAuthorized('team:team-1', 'secret:event', {}, access.requireTeamMember);

    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.leave).toHaveBeenCalledWith('team:team-1');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('revalidates an existing socket before joining a protected room', async () => {
    const socket = { data: { token: 'token', userId: 'user-1', jti: 'jti-1' }, join: jest.fn() };
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', jti: 'jti-1' });
    sessions.assertActive.mockRejectedValue(new Error('revoked'));

    await expect(gateway.handleJoinTeam(socket as any, 'team-1')).resolves.toEqual(expect.objectContaining({ event: 'join:error' }));
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('disconnects only sockets belonging to the logged-out session', () => {
    const first = { data: { jti: 'jti-1' }, disconnect: jest.fn() };
    const second = { data: { jti: 'jti-2' }, disconnect: jest.fn() };
    (gateway as any).server = { sockets: { sockets: new Map([['one', first], ['two', second]]) } };

    gateway.disconnectSession('jti-1');

    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(second.disconnect).not.toHaveBeenCalled();
  });

  it('synchronizes two authorized team sessions, removes an outsider, and permits a reconnect to receive newer activity', async () => {
    const memberA = { data: { token: 'a', userId: 'member-a', jti: 'a' }, emit: jest.fn(), leave: jest.fn(), disconnect: jest.fn() };
    const memberB = { data: { token: 'b', userId: 'member-b', jti: 'b' }, emit: jest.fn(), leave: jest.fn(), disconnect: jest.fn() };
    const outsider = { data: { token: 'o', userId: 'outsider', jti: 'o' }, emit: jest.fn(), leave: jest.fn(), disconnect: jest.fn() };
    jwt.verifyAsync.mockImplementation(async (token: string) => ({ sub: token === 'a' ? 'member-a' : token === 'b' ? 'member-b' : 'outsider', jti: token }));
    sessions.assertActive.mockResolvedValue(undefined);
    access.requireTeamMember.mockImplementation(async (_team: string, user: string) => {
      if (user === 'outsider') throw new Error('not a member');
    });
    (gateway as any).server = { in: () => ({ fetchSockets: jest.fn().mockResolvedValue([memberA, memberB, outsider]) }) };

    await gateway.emitToTeam('team-1', 'planning:activity', { id: 'activity-2', createdAt: '2026-09-16T00:01:00Z' });
    expect(memberA.emit).toHaveBeenCalledWith('planning:activity', expect.objectContaining({ id: 'activity-2' }));
    expect(memberB.emit).toHaveBeenCalledWith('planning:activity', expect.objectContaining({ id: 'activity-2' }));
    expect(outsider.emit).not.toHaveBeenCalled();
    expect(outsider.leave).toHaveBeenCalledWith('team:team-1');
    expect(outsider.disconnect).toHaveBeenCalledWith(true);

    const reconnectedA = { data: { token: 'a', userId: 'member-a', jti: 'a' }, emit: jest.fn(), leave: jest.fn(), disconnect: jest.fn() };
    (gateway as any).server = { in: () => ({ fetchSockets: jest.fn().mockResolvedValue([reconnectedA]) }) };
    await gateway.emitToTeam('team-1', 'planning:activity', { id: 'activity-3', createdAt: '2026-09-16T00:02:00Z' });
    expect(reconnectedA.emit).toHaveBeenCalledWith('planning:activity', expect.objectContaining({ id: 'activity-3' }));
  });
});
