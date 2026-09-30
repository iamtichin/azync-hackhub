import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { PlanningService } from './planning.service';
import {
  CreateAreaDto,
  UpdateAreaDto,
  CreateTaskDto,
  UpdateTaskDto,
  AddDependencyDto,
  ApplyPlanningTemplateDto,
} from './dto/planning.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('planning')
@Controller('teams/:teamId/planning')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  // ==================== AREAS ====================

  @Post('areas')
  @ApiOperation({ summary: 'Create area for team' })
  createArea(
    @Param('teamId') teamId: string,
    @Body() createAreaDto: CreateAreaDto,
    @Req() req: any,
  ) {
    return this.planningService.createArea(teamId, createAreaDto, req.user.id);
  }

  @Get('areas')
  @ApiOperation({ summary: 'Get all areas for team' })
  getAreas(@Param('teamId') teamId: string, @Req() req: any) {
    return this.planningService.getAreas(teamId, req.user.id);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Get team-scoped planning activity after an optional activity cursor' })
  getActivity(@Param('teamId') teamId: string, @Req() req: any, @Query('after') after?: string) {
    return this.planningService.getActivity(teamId, req.user.id, after);
  }

  @Patch('areas/:areaId')
  @ApiOperation({ summary: 'Update area' })
  updateArea(
    @Param('teamId') teamId: string,
    @Param('areaId') areaId: string,
    @Body() updateAreaDto: UpdateAreaDto,
    @Req() req: any,
  ) {
    return this.planningService.updateArea(areaId, updateAreaDto, req.user.id, teamId);
  }

  @Delete('areas/:areaId')
  @ApiOperation({ summary: 'Delete area' })
  deleteArea(@Param('teamId') teamId: string, @Param('areaId') areaId: string, @Req() req: any) {
    return this.planningService.deleteArea(areaId, req.user.id, teamId);
  }

  // ==================== TASKS ====================

  @Post('tasks')
  @ApiOperation({ summary: 'Create task for team' })
  createTask(
    @Param('teamId') teamId: string,
    @Body() createTaskDto: CreateTaskDto,
    @Req() req: any,
  ) {
    return this.planningService.createTask(teamId, createTaskDto, req.user.id);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Get all tasks for team' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'assigneeId', required: false, description: 'User ID or unassigned' })
  getTasks(
    @Param('teamId') teamId: string,
    @Req() req: any,
    @Query('status') status?: string,
    @Query('areaId') areaId?: string,
    @Query('assigneeId') assigneeId?: string,
  ) {
    return this.planningService.getTasks(teamId, req.user.id, status, areaId, assigneeId);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Apply a built-in planning template atomically to an empty canvas' })
  applyTemplate(
    @Param('teamId') teamId: string,
    @Body() dto: ApplyPlanningTemplateDto,
    @Req() req: any,
  ) {
    return this.planningService.applyTemplate(teamId, dto.templateId, req.user.id);
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: 'Get task by ID' })
  getTask(
    @Param('teamId') teamId: string,
    @Param('taskId') taskId: string,
    @Req() req: any,
  ) {
    return this.planningService.getTask(teamId, taskId, req.user.id);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({ summary: 'Update task' })
  updateTask(
    @Param('teamId') teamId: string,
    @Param('taskId') taskId: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @Req() req: any,
  ) {
    return this.planningService.updateTask(taskId, updateTaskDto, req.user.id, teamId);
  }

  @Delete('tasks/:taskId')
  @ApiOperation({ summary: 'Delete task' })
  deleteTask(@Param('teamId') teamId: string, @Param('taskId') taskId: string, @Req() req: any) {
    return this.planningService.deleteTask(taskId, req.user.id, teamId);
  }

  // ==================== DEPENDENCIES ====================

  @Post('tasks/:taskId/dependencies')
  @ApiOperation({ summary: 'Add task dependency' })
  addDependency(
    @Param('teamId') teamId: string,
    @Param('taskId') taskId: string,
    @Body() addDependencyDto: AddDependencyDto,
    @Req() req: any,
  ) {
    return this.planningService.addDependency(
      taskId,
      addDependencyDto,
      req.user.id,
      teamId,
    );
  }

  @Delete('tasks/:taskId/dependencies/:dependsOnId')
  @ApiOperation({ summary: 'Remove task dependency' })
  removeDependency(
    @Param('teamId') teamId: string,
    @Param('taskId') taskId: string,
    @Param('dependsOnId') dependsOnId: string,
    @Req() req: any,
  ) {
    return this.planningService.removeDependency(
      taskId,
      dependsOnId,
      req.user.id,
      teamId,
    );
  }

  // ==================== CRITICAL PATH ====================

  @Get('critical-path')
  @ApiOperation({ summary: 'Calculate critical path for team' })
  getCriticalPath(@Param('teamId') teamId: string, @Req() req: any) {
    return this.planningService.calculateCriticalPath(teamId, req.user.id);
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Forecast finish from completed-task velocity and dependencies' })
  getForecast(@Param('teamId') teamId: string, @Req() req: any) {
    return this.planningService.getForecast(teamId, req.user.id);
  }
}
