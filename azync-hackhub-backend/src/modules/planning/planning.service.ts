import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../../events/events.gateway';
import { HackathonsService } from '../hackathons/hackathons.service';
import {
  CreateAreaDto,
  UpdateAreaDto,
  CreateTaskDto,
  UpdateTaskDto,
  AddDependencyDto,
} from './dto/planning.dto';
import { PLANNING_TEMPLATES, type PlanningTemplateId } from './planning.templates';
import { calculatePlanningForecast } from './planning.forecast';

@Injectable()
export class PlanningService {
  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    @Inject(forwardRef(() => HackathonsService))
    private hackathonsService: HackathonsService,
  ) {}

  // ==================== AREAS ====================

  async createArea(
    teamId: string,
    createAreaDto: CreateAreaDto,
    userId: string,
  ) {
    await this.checkTeamMembership(teamId, userId);
    this.validateHours(createAreaDto);
    const area = await this.prisma.area.create({
      data: {
        teamId,
        ...createAreaDto,
      },
      include: {
        _count: {
          select: { tasks: true },
        },
      },
    });
    this.eventsGateway.emitToTeam(teamId, 'area:created', area);
    await this.recordActivity(teamId, userId, 'area.created', 'area', area.id, { name: area.name });
    return area;
  }

  async getAreas(teamId: string, userId: string) {
    await this.checkTeamMembership(teamId, userId);
    return this.prisma.area.findMany({
      where: { teamId },
      include: {
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            estimatedHours: true,
            actualHours: true,
          },
        },
        _count: {
          select: { tasks: true },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async updateArea(
    areaId: string,
    updateAreaDto: UpdateAreaDto,
    userId: string,
    teamId?: string,
  ) {
    const area = await this.prisma.area.findUnique({
      where: { id: areaId },
    });

    if (!area || (teamId !== undefined && area.teamId !== teamId)) {
      throw new NotFoundException('Area not found');
    }

    await this.checkTeamMembership(area.teamId, userId);
    this.validateHours(updateAreaDto);

    const updated = await this.prisma.area.update({
      where: { id: areaId },
      data: updateAreaDto,
    });
    this.eventsGateway.emitToTeam(area.teamId, 'area:updated', updated);
    await this.recordActivity(area.teamId, userId, 'area.updated', 'area', areaId);
    return updated;
  }

  async deleteArea(areaId: string, userId: string, teamId?: string) {
    const area = await this.prisma.area.findUnique({
      where: { id: areaId },
    });

    if (!area || (teamId !== undefined && area.teamId !== teamId)) {
      throw new NotFoundException('Area not found');
    }

    await this.checkTeamMembership(area.teamId, userId);

    const deleted = await this.prisma.area.delete({
      where: { id: areaId },
    });
    this.eventsGateway.emitToTeam(area.teamId, 'area:deleted', { id: areaId });
    await this.recordActivity(area.teamId, userId, 'area.deleted', 'area', areaId);
    return deleted;
  }

  // ==================== TASKS ====================

  async createTask(
    teamId: string,
    createTaskDto: CreateTaskDto,
    userId: string,
  ) {
    await this.checkTeamMembership(teamId, userId);
    this.validateHours(createTaskDto);
    await this.validateTaskReferences(teamId, createTaskDto);

    const task = await this.prisma.task.create({
      data: {
        teamId,
        ...createTaskDto,
      },
      include: {
        area: true,
        assignee: {
          select: { id: true, name: true, githubUsername: true, avatarUrl: true },
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                title: true,
                status: true,
              },
            },
          },
        },
      },
    });

    // Emit real-time event
    this.eventsGateway.emitToTeam(teamId, 'task:created', task);
    await this.recordActivity(teamId, userId, 'task.created', 'task', task.id, { title: task.title });
    void this.emitLeaderboardForTeam(teamId).catch(() => undefined);

    return task;
  }

  async getTasks(
    teamId: string,
    userId: string,
    status?: string,
    areaId?: string,
    assigneeId?: string,
  ) {
    await this.checkTeamMembership(teamId, userId);
    const where: any = { teamId };

    if (status) {
      where.status = status;
    }

    if (areaId) {
      where.areaId = areaId;
    }

    if (assigneeId) {
      where.assigneeId = assigneeId === 'unassigned' ? null : assigneeId;
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        area: true,
        assignee: {
          select: { id: true, name: true, githubUsername: true, avatarUrl: true },
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                title: true,
                status: true,
              },
            },
          },
        },
        blockers: {
          include: {
            task: {
              select: {
                id: true,
                title: true,
                status: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate critical path
    const { criticalPath: criticalPathTaskIds } =
      await this.calculateCriticalPathForTeam(teamId);

    // Mark tasks on critical path
    return tasks.map((task) => ({
      ...task,
      isCriticalPath: criticalPathTaskIds.includes(task.id),
    }));
  }

  async getTask(teamId: string, taskId: string, userId: string) {
    await this.checkTeamMembership(teamId, userId);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, teamId },
      include: {
        area: true,
        assignee: {
          select: { id: true, name: true, githubUsername: true, avatarUrl: true },
        },
        dependencies: {
          include: {
            dependsOn: true,
          },
        },
        blockers: {
          include: {
            task: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async updateTask(
    taskId: string,
    updateTaskDto: UpdateTaskDto,
    userId: string,
    teamId?: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        team: {
          select: {
            hackathonId: true,
          },
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                title: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!task || (teamId !== undefined && task.teamId !== teamId)) {
      throw new NotFoundException('Task not found');
    }

    await this.checkTeamMembership(task.teamId, userId);
    this.validateHours(updateTaskDto);
    await this.validateTaskReferences(task.teamId, updateTaskDto);

    if (
      updateTaskDto.status === 'in_progress' ||
      updateTaskDto.status === 'done'
    ) {
      const unfinishedDependencies = (task.dependencies ?? []).filter(
        (dependency) => dependency.dependsOn.status !== 'done',
      );
      if (unfinishedDependencies.length > 0) {
        throw new BadRequestException(
          `Cannot move task to ${updateTaskDto.status} until dependencies are done: ${unfinishedDependencies
            .map((dependency) => dependency.dependsOn.title)
            .join(', ')}`,
        );
      }
    }

    // Update timestamps based on status changes
    const updateData: any = { ...updateTaskDto };

    if (
      updateTaskDto.status === 'in_progress' &&
      !task.startedAt
    ) {
      updateData.startedAt = new Date();
    }

    if (updateTaskDto.status === 'done' && task.status !== 'done') {
      updateData.completedAt = new Date();
    }
    if (updateTaskDto.status && updateTaskDto.status !== 'done') {
      updateData.completedAt = null;
    }

    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        area: true,
        assignee: {
          select: { id: true, name: true, githubUsername: true, avatarUrl: true },
        },
        dependencies: {
          include: {
            dependsOn: true,
          },
        },
      },
    });

    // Emit real-time event
    this.eventsGateway.emitToTeam(task.teamId, 'task:updated', updatedTask);
    await this.recordActivity(task.teamId, userId, 'task.updated', 'task', taskId, {
      status: updatedTask.status,
    });

    // Trigger leaderboard update if status changed
    if (updateTaskDto.status && updateTaskDto.status !== task.status) {
      this.hackathonsService.emitLeaderboardUpdate(task.team.hackathonId);
    }

    return updatedTask;
  }

  async deleteTask(taskId: string, userId: string, teamId?: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || (teamId !== undefined && task.teamId !== teamId)) {
      throw new NotFoundException('Task not found');
    }

    await this.checkTeamMembership(task.teamId, userId);

    const deletedTask = await this.prisma.task.delete({
      where: { id: taskId },
    });

    // Emit real-time event
    this.eventsGateway.emitToTeam(task.teamId, 'task:deleted', { id: taskId });
    await this.recordActivity(task.teamId, userId, 'task.deleted', 'task', taskId);
    void this.emitLeaderboardForTeam(task.teamId).catch(() => undefined);

    return deletedTask;
  }

  // ==================== DEPENDENCIES ====================

  async addDependency(
    taskId: string,
    addDependencyDto: AddDependencyDto,
    userId: string,
    teamId?: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || (teamId !== undefined && task.teamId !== teamId)) {
      throw new NotFoundException('Task not found');
    }

    await this.checkTeamMembership(task.teamId, userId);

    // Verify dependsOn task exists and belongs to same team
    const dependsOnTask = await this.prisma.task.findUnique({
      where: { id: addDependencyDto.dependsOnId },
    });

    if (!dependsOnTask) {
      throw new NotFoundException('Dependency task not found');
    }

    if (dependsOnTask.teamId !== task.teamId) {
      throw new BadRequestException('Tasks must belong to the same team');
    }

    const dependency = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${task.teamId}))`;
        if (
          await this.wouldCreateCycle(
            taskId,
            addDependencyDto.dependsOnId,
            tx,
          )
        ) {
          throw new BadRequestException(
            'This would create a circular dependency',
          );
        }
        return tx.taskDependency.create({
          data: { taskId, dependsOnId: addDependencyDto.dependsOnId },
          include: { task: true, dependsOn: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.eventsGateway.emitToTeam(task.teamId, 'dependency:created', dependency);
    await this.recordActivity(task.teamId, userId, 'dependency.created', 'dependency', dependency.id, {
      taskId,
      dependsOnId: addDependencyDto.dependsOnId,
    });
    return dependency;
  }

  async removeDependency(taskId: string, dependsOnId: string, userId: string, teamId?: string) {
    const dependency = await this.prisma.taskDependency.findUnique({
      where: {
        taskId_dependsOnId: {
          taskId,
          dependsOnId,
        },
      },
      include: {
        task: true,
      },
    });

    if (!dependency || (teamId !== undefined && dependency.task.teamId !== teamId)) {
      throw new NotFoundException('Dependency not found');
    }

    await this.checkTeamMembership(dependency.task.teamId, userId);

    const deleted = await this.prisma.taskDependency.delete({
      where: {
        taskId_dependsOnId: {
          taskId,
          dependsOnId,
        },
      },
    });
    this.eventsGateway.emitToTeam(dependency.task.teamId, 'dependency:deleted', { taskId, dependsOnId });
    await this.recordActivity(dependency.task.teamId, userId, 'dependency.deleted', 'dependency', deleted.id, { taskId, dependsOnId });
    return deleted;
  }

  async getActivity(teamId: string, userId: string, after?: string) {
    await this.checkTeamMembership(teamId, userId);
    const cursor = after
      ? await this.prisma.teamActivity.findFirst({ where: { id: after, teamId }, select: { id: true, createdAt: true } })
      : null;
    // A stale/foreign cursor must never fall back to a full snapshot: doing so
    // could let a delayed reconnect response overwrite newer local activity.
    if (after && !cursor) return { items: [], nextCursor: null };
    const rows = await this.prisma.teamActivity.findMany({
      where: {
        teamId,
        ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
      },
      include: { actor: { select: { id: true, name: true, githubUsername: true, avatarUrl: true } } },
      // Initial open needs current activity, while a cursor reconnect must
      // preserve chronological order and expose a continuation cursor.
      orderBy: after ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: after ? 101 : 100,
    });
    if (!after) return { items: rows.reverse(), nextCursor: null };
    const items = rows.slice(0, 100);
    return { items, nextCursor: rows.length > 100 ? items.at(-1)?.id ?? null : null };
  }

  // ==================== TEMPLATES ====================

  async applyTemplate(
    teamId: string,
    templateId: PlanningTemplateId,
    userId: string,
  ) {
    await this.checkTeamMembership(teamId, userId);
    const template = PLANNING_TEMPLATES[templateId];
    if (!template) throw new BadRequestException('Unknown planning template');

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teamId}))`;
        const [areaCount, taskCount] = await Promise.all([
          tx.area.count({ where: { teamId } }),
          tx.task.count({ where: { teamId } }),
        ]);
        if (areaCount || taskCount) {
          throw new ConflictException(
            'Planning template requires an empty canvas',
          );
        }

        const areaIds = new Map<string, string>();
        for (const [displayOrder, area] of template.areas.entries()) {
          const created = await tx.area.create({
            data: {
              teamId,
              name: area.name,
              color: area.color,
              displayOrder,
              estimatedHours: template.tasks
                .filter((task) => task.area === area.key)
                .reduce((sum, task) => sum + task.estimatedHours, 0),
            },
          });
          areaIds.set(area.key, created.id);
        }

        const taskIds = new Map<string, string>();
        for (const item of template.tasks) {
          const created = await tx.task.create({
            data: {
              teamId,
              areaId: areaIds.get(item.area),
              title: item.title,
              estimatedHours: item.estimatedHours,
              priority: item.priority,
              status: 'todo',
            },
          });
          taskIds.set(item.key, created.id);
        }
        for (const item of template.tasks) {
          for (const dependencyKey of item.dependsOn ?? []) {
            await tx.taskDependency.create({
              data: {
                taskId: taskIds.get(item.key)!,
                dependsOnId: taskIds.get(dependencyKey)!,
              },
            });
          }
        }

        const [areas, tasks] = await Promise.all([
          tx.area.findMany({
            where: { teamId },
            include: { _count: { select: { tasks: true } } },
            orderBy: { displayOrder: 'asc' },
          }),
          tx.task.findMany({
            where: { teamId },
            include: {
              area: true,
              assignee: {
                select: {
                  id: true,
                  name: true,
                  githubUsername: true,
                  avatarUrl: true,
                },
              },
              dependencies: {
                include: {
                  dependsOn: {
                    select: { id: true, title: true, status: true },
                  },
                },
              },
              blockers: {
                include: {
                  task: { select: { id: true, title: true, status: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        return { areas, tasks };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    await this.recordActivity(teamId, userId, 'planning.template_applied', 'planning_template', templateId, {
      templateId,
      areaCount: result.areas.length,
      taskCount: result.tasks.length,
    });
    void this.eventsGateway.emitToTeam(
      teamId,
      'planning:template-applied',
      { templateId, ...result },
    );
    return result;
  }

  // ==================== CRITICAL PATH ====================

  async calculateCriticalPath(teamId: string, userId: string) {
    await this.checkTeamMembership(teamId, userId);
    return this.calculateCriticalPathForTeam(teamId);
  }

  async getForecast(teamId: string, userId: string) {
    await this.checkTeamMembership(teamId, userId);
    const [tasks, team, criticalPath] = await Promise.all([
      this.prisma.task.findMany({
        where: { teamId },
        select: {
          id: true,
          status: true,
          estimatedHours: true,
          actualHours: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      }),
      this.prisma.team.findUnique({
        where: { id: teamId },
        select: { hackathonId: true },
      }),
      this.calculateCriticalPathForTeam(teamId),
    ]);
    const hackathon = team
      ? await this.prisma.hackathon.findUnique({
          where: { id: team.hackathonId },
          select: { endDate: true },
        })
      : null;
    return calculatePlanningForecast(
      tasks,
      criticalPath.totalHours,
      hackathon?.endDate ?? null,
    );
  }

  private async calculateCriticalPathForTeam(teamId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { teamId, status: { not: 'done' } },
      include: {
        dependencies: true,
        area: { select: { name: true } },
      },
    });

    if (tasks.length === 0) {
      await this.prisma.task.updateMany({
        where: { teamId, isCriticalPath: true },
        data: { isCriticalPath: false },
      });
      return { criticalPath: [], totalHours: 0, tasks: [] };
    }

    // Build adjacency list
    const graph = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const taskMap = new Map<string, any>();

    tasks.forEach((task) => {
      taskMap.set(task.id, task);
      graph.set(task.id, []);
      inDegree.set(task.id, 0);
    });

    tasks.forEach((task) => {
      task.dependencies.forEach((dep) => {
        if (graph.has(dep.dependsOnId)) {
          graph.get(dep.dependsOnId)!.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      });
    });

    // Topological sort with longest path calculation
    const queue: string[] = [];
    const distance = new Map<string, number>();
    const parent = new Map<string, string | null>();

    tasks.forEach((task) => {
      distance.set(task.id, task.estimatedHours);
      parent.set(task.id, null);
      if (inDegree.get(task.id) === 0) {
        queue.push(task.id);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = graph.get(current) || [];

      neighbors.forEach((neighbor) => {
        const newDist =
          distance.get(current)! + taskMap.get(neighbor).estimatedHours;

        if (newDist > distance.get(neighbor)!) {
          distance.set(neighbor, newDist);
          parent.set(neighbor, current);
        }

        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      });
    }

    // Find the task with maximum distance (end of critical path)
    let maxDist = 0;
    let endTask: string | null = null;

    distance.forEach((dist, taskId) => {
      if (dist > maxDist) {
        maxDist = dist;
        endTask = taskId;
      }
    });

    if (!endTask) {
      return { criticalPath: [], totalHours: 0, tasks: [] };
    }

    // Trace back the critical path
    const criticalPath: string[] = [];
    let current: string | null = endTask;

    while (current) {
      criticalPath.unshift(current);
      current = parent.get(current) || null;
    }

    // Update isCriticalPath flag in database
    await this.prisma.task.updateMany({
      where: { teamId },
      data: { isCriticalPath: false },
    });

    if (criticalPath.length > 0) {
      await this.prisma.task.updateMany({
        where: { id: { in: criticalPath } },
        data: { isCriticalPath: true },
      });
    }

    return {
      criticalPath,
      totalHours: maxDist,
      tasks: criticalPath.map((taskId) => {
        const task = taskMap.get(taskId);
        return {
          id: task.id,
          title: task.title,
          description: task.description,
          estimatedHours: task.estimatedHours,
          actualHours: task.actualHours,
          status: task.status,
          areaId: task.areaId,
          areaName: task.area?.name ?? null,
          isCriticalPath: true,
          dependencies: task.dependencies.map((item) => item.dependsOnId),
        };
      }),
    };
  }

  // ==================== HELPERS ====================

  private validateHours(input: { estimatedHours?: number; actualHours?: number }) {
    for (const field of ['estimatedHours', 'actualHours'] as const) {
      const value = input[field];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new BadRequestException(`${field} must be a finite nonnegative number`);
      }
    }
  }

  private async validateTaskReferences(teamId: string, input: { areaId?: string | null; assigneeId?: string | null }) {
    if (input.areaId !== undefined && input.areaId !== null) {
      const area = await this.prisma.area.findFirst({ where: { id: input.areaId, teamId } });
      if (!area) throw new BadRequestException('Area not found or does not belong to this team');
    }
    if (input.assigneeId !== undefined && input.assigneeId !== null) {
      const member = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: input.assigneeId } },
      });
      if (!member) throw new BadRequestException('Assignee must be a current member of this team');
    }
  }

  private async checkTeamMembership(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this team');
    }
  }

  private async recordActivity(
    teamId: string,
    actorId: string,
    action: string,
    subjectType: string,
    subjectId: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      const activity = await this.prisma.teamActivity.create({
        data: { teamId, actorId, action, subjectType, subjectId, metadata: metadata as Prisma.InputJsonValue | undefined },
        include: { actor: { select: { id: true, name: true, githubUsername: true, avatarUrl: true } } },
      });
      // The primary mutation is committed before activity is attempted. Keep
      // this best-effort so an activity outage cannot create a false failure
      // that makes a client retry an already-successful mutation.
      this.eventsGateway.emitToTeam(teamId, 'planning:activity', activity);
      return activity;
    } catch {
      return null;
    }
  }

  private async emitLeaderboardForTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { hackathonId: true },
    });
    if (team) await this.hackathonsService.emitLeaderboardUpdate(team.hackathonId);
  }

  private async wouldCreateCycle(
    taskId: string,
    dependsOnId: string,
    client: Pick<Prisma.TransactionClient, 'taskDependency'> = this.prisma,
  ): Promise<boolean> {
    const visited = new Set<string>();
    const queue = [dependsOnId];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === taskId) {
        return true;
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const dependencies = await client.taskDependency.findMany({
        where: { taskId: current },
      });

      dependencies.forEach((dep) => {
        queue.push(dep.dependsOnId);
      });
    }

    return false;
  }
}
