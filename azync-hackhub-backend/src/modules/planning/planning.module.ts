import { Module, forwardRef } from '@nestjs/common';
import { PlanningService } from './planning.service';
import { PlanningController } from './planning.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HackathonsModule } from '../hackathons/hackathons.module';

@Module({
  imports: [PrismaModule, forwardRef(() => HackathonsModule)],
  controllers: [PlanningController],
  providers: [PlanningService],
  exports: [PlanningService],
})
export class PlanningModule {}
