import { Injectable } from '@nestjs/common';
import type { AiJobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AiMetrics {
  totalAnalyses: number;
  totalJobs: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  jobsByStatus: Record<AiJobStatus, number>;
  totalCostUsd: number;
  averageLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

const EMPTY_JOB_COUNTS: Record<AiJobStatus, number> = {
  QUEUED: 0,
  PROCESSING: 0,
  RETRYING: 0,
  COMPLETED: 0,
  FAILED: 0,
};

@Injectable()
export class MetricsTracker {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(): Promise<AiMetrics> {
    const [analyses, groupedJobs] = await Promise.all([
      this.prisma.aiAnalysis.aggregate({
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.aiJob.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);
    const jobsByStatus = { ...EMPTY_JOB_COUNTS };
    for (const group of groupedJobs) {
      jobsByStatus[group.status] = group._count._all;
    }

    return {
      totalAnalyses: analyses._count._all,
      totalJobs: Object.values(jobsByStatus).reduce(
        (total, count) => total + count,
        0,
      ),
      successfulAnalyses: jobsByStatus.COMPLETED,
      failedAnalyses: jobsByStatus.FAILED,
      jobsByStatus,
      totalCostUsd: analyses._sum.costUsd?.toNumber() ?? 0,
      averageLatencyMs: analyses._avg.latencyMs ?? 0,
      totalInputTokens: analyses._sum.inputTokens ?? 0,
      totalOutputTokens: analyses._sum.outputTokens ?? 0,
    };
  }
}
