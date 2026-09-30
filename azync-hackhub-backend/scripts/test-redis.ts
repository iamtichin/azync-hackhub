import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createRedisConnectionOptions } from '../src/config/redis.config';
import { AI_ANALYSIS_QUEUE } from '../src/modules/ai/ai-queue.constants';

async function main(): Promise<void> {
  const connection = createRedisConnectionOptions(process.env);
  const redis = new Redis({ ...connection, lazyConnect: true });
  const queue = new Queue(AI_ANALYSIS_QUEUE, { connection });

  try {
    await redis.connect();
    const pong = await redis.ping();
    await queue.waitUntilReady();
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
    );

    console.log(
      JSON.stringify({
        redis: pong,
        queue: AI_ANALYSIS_QUEUE,
        ready: true,
        counts,
      }),
    );
  } finally {
    await Promise.allSettled([queue.close(), redis.quit()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
