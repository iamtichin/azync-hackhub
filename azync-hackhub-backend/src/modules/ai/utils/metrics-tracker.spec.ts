import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { MetricsTracker } from './metrics-tracker';

describe('MetricsTracker', () => {
  it('aggregates durable job and analysis metrics', async () => {
    const prisma = {
      aiAnalysis: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 3 },
          _sum: {
            inputTokens: 120,
            outputTokens: 45,
            costUsd: new Prisma.Decimal('1.25'),
          },
          _avg: { latencyMs: 250 },
        }),
      },
      aiJob: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'COMPLETED', _count: { _all: 3 } },
          { status: 'FAILED', _count: { _all: 1 } },
        ]),
      },
    } as unknown as PrismaService;

    await expect(new MetricsTracker(prisma).getMetrics()).resolves.toEqual({
      totalAnalyses: 3,
      totalJobs: 4,
      successfulAnalyses: 3,
      failedAnalyses: 1,
      jobsByStatus: {
        QUEUED: 0,
        PROCESSING: 0,
        RETRYING: 0,
        COMPLETED: 3,
        FAILED: 1,
      },
      totalCostUsd: 1.25,
      averageLatencyMs: 250,
      totalInputTokens: 120,
      totalOutputTokens: 45,
    });
  });
});
