import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessPolicyService } from '../modules/access/access-policy.service';
import { AuthSessionService } from '../modules/auth/security/auth-session.service';

@WebSocketGateway({
  cors: {
    origin: [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
      'http://localhost:3001',
    ].filter(Boolean),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('EventsGateway');
  private readonly connectionAuthentication = new WeakMap<Socket, Promise<void>>();

  constructor(private readonly jwt: JwtService, private readonly access: AccessPolicyService, private readonly sessions: AuthSessionService) {}

  async handleConnection(client: Socket) {
    // Socket.IO may dispatch a join message before this async hook finishes.
    // Publish the promise synchronously so joins wait for the same authentication.
    const authentication = this.authenticateConnection(client);
    this.connectionAuthentication.set(client, authentication);
    try {
      await authentication;
    } catch {
      client.emit('auth:error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    if (client.data.expiryTimer) clearTimeout(client.data.expiryTimer);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Join team room
  @SubscribeMessage('join:team')
  async handleJoinTeam(client: Socket, teamId: string) {
    try { await this.revalidateSocket(client); await this.access.requireTeamMember(teamId, client.data.userId); } catch { return this.denied('team'); }
    client.join(`team:${teamId}`);
    this.logger.log(`Client ${client.id} joined team:${teamId}`);
    return { event: 'joined:team', data: teamId };
  }

  // Leave team room
  @SubscribeMessage('leave:team')
  handleLeaveTeam(client: Socket, teamId: string) {
    client.leave(`team:${teamId}`);
    this.logger.log(`Client ${client.id} left team:${teamId}`);
    return { event: 'left:team', data: teamId };
  }

  // Join hackathon room
  @SubscribeMessage('join:hackathon')
  async handleJoinHackathon(client: Socket, hackathonId: string) {
    try { await this.revalidateSocket(client); await this.access.requireHackathonPrivateAccess(hackathonId, client.data.userId); } catch { return this.denied('hackathon'); }
    client.join(`hackathon:private:${hackathonId}`);
    this.logger.log(`Client ${client.id} joined hackathon:${hackathonId}`);
    return { event: 'joined:hackathon', data: hackathonId };
  }

  // Leave hackathon room
  @SubscribeMessage('leave:hackathon')
  handleLeaveHackathon(client: Socket, hackathonId: string) {
    client.leave(`hackathon:private:${hackathonId}`);
    this.logger.log(`Client ${client.id} left hackathon:${hackathonId}`);
    return { event: 'left:hackathon', data: hackathonId };
  }

  @SubscribeMessage('join:leaderboard')
  async handleJoinLeaderboard(client: Socket, hackathonId: string) {
    try { await this.revalidateSocket(client); await this.access.requirePublishedHackathon(hackathonId); } catch { return this.denied('leaderboard'); }
    client.join(`hackathon:public:${hackathonId}`);
    return { event: 'joined:leaderboard', data: hackathonId };
  }

  // Emit events to specific rooms. Private hackathon events never share a public room.
  emitToTeam(teamId: string, event: string, data: any) {
    this.logger.log(`Emitted ${event} to team:${teamId}`);
    return this.emitAuthorized(`team:${teamId}`, event, data, (userId) => this.access.requireTeamMember(teamId, userId))
      .catch((error) => this.logger.error(`Failed to emit ${event} to team:${teamId}`, error instanceof Error ? error.stack : String(error)));
  }

  emitToHackathon(hackathonId: string, event: string, data: any) {
    this.logger.log(`Emitted ${event} to hackathon:${hackathonId}`);
    return this.emitAuthorized(`hackathon:private:${hackathonId}`, event, data, (userId) => this.access.requireHackathonPrivateAccess(hackathonId, userId))
      .catch((error) => this.logger.error(`Failed to emit ${event} to hackathon:${hackathonId}`, error instanceof Error ? error.stack : String(error)));
  }

  emitToPublicHackathon(hackathonId: string, event: string, data: any) {
    return this.access.requirePublishedHackathon(hackathonId)
      .then(() => this.server.to(`hackathon:public:${hackathonId}`).emit(event, data))
      .catch(() => undefined);
  }

  disconnectSession(jti: string | undefined) {
    if (!jti) return;
    for (const socket of this.server?.sockets.sockets.values() ?? []) if (socket.data.jti === jti) socket.disconnect(true);
  }

  private token(client: Socket) {
    const auth = client.handshake.auth?.token || client.handshake.headers.authorization;
    if (typeof auth !== 'string') throw new UnauthorizedException();
    return auth.replace(/^Bearer\s+/i, '');
  }

  private denied(resource: string) { return { event: 'join:error', data: { resource, message: 'Access denied' } }; }

  private async authenticateConnection(client: Socket): Promise<void> {
    const token = this.token(client);
    const payload = await this.jwt.verifyAsync<{ sub: string; jti?: string; exp?: number }>(token, { algorithms: ['HS256'] });
    if (!payload.sub || !payload.jti || !Number.isSafeInteger(payload.exp)) throw new UnauthorizedException();
    await this.sessions.assertActive(payload.jti);
    if (client.connected === false) throw new UnauthorizedException();
    client.data.userId = payload.sub;
    client.data.jti = payload.jti;
    client.data.token = token;
    if (payload.exp) {
      client.data.expiryTimer = setTimeout(
        () => client.disconnect(true),
        Math.max(0, payload.exp * 1000 - Date.now()),
      );
    }
  }

  private async revalidateSocket(socket: Socket) {
    const authentication = this.connectionAuthentication.get(socket);
    if (authentication) await authentication;
    if (socket.connected === false) throw new UnauthorizedException();
    const payload = await this.jwt.verifyAsync<{ sub: string; jti?: string }>(socket.data.token, { algorithms: ['HS256'] });
    if (!payload.sub || !payload.jti || payload.sub !== socket.data.userId || payload.jti !== socket.data.jti) throw new UnauthorizedException();
    await this.sessions.assertActive(payload.jti);
  }

  private async emitAuthorized(room: string, event: string, data: any, authorize: (userId: string) => Promise<unknown>) {
    for (const socket of await this.server.in(room).fetchSockets()) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; jti?: string }>(socket.data.token, { algorithms: ['HS256'] });
        if (!payload.sub || payload.sub !== socket.data.userId) throw new UnauthorizedException();
        if (!payload.jti) throw new UnauthorizedException();
        await this.sessions.assertActive(payload.jti);
        await authorize(payload.sub);
        socket.emit(event, data);
      } catch {
        socket.leave(room);
        socket.disconnect(true);
      }
    }
  }

  // Broadcast to all clients
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
    this.logger.log(`Broadcasted ${event} to all clients`);
  }
}
