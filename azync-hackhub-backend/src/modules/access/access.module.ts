import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessPolicyService } from './access-policy.service';

@Global()
@Module({ imports: [PrismaModule], providers: [AccessPolicyService], exports: [AccessPolicyService] })
export class AccessModule {}
