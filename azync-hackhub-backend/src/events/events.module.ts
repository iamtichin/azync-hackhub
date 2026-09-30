import { Module, Global } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { AccessModule } from '../modules/access/access.module';
import { AuthModule } from '../modules/auth/auth.module';

@Global()
@Module({
  imports: [AccessModule, AuthModule],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
