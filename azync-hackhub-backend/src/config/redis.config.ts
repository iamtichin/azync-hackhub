import type { RedisOptions } from 'ioredis';
import { createAiAnalysisDefaultJobOptions } from '../modules/ai/ai-queue.constants';

const DEFAULT_REDIS_HOST = '127.0.0.1';
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_REDIS_DB = 0;

export interface RedisEnvironment {
  REDIS_HOST?: string;
  REDIS_PORT?: string | number;
  REDIS_PASSWORD?: string;
  REDIS_DB?: string | number;
}

function parseInteger(
  value: string | number | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return parsed;
}

export function createRedisConnectionOptions(
  environment: RedisEnvironment,
): RedisOptions {
  const host = environment.REDIS_HOST?.trim() || DEFAULT_REDIS_HOST;
  const password = environment.REDIS_PASSWORD?.trim();

  return {
    host,
    port: parseInteger(
      environment.REDIS_PORT,
      DEFAULT_REDIS_PORT,
      'REDIS_PORT',
      1,
      65_535,
    ),
    db: parseInteger(environment.REDIS_DB, DEFAULT_REDIS_DB, 'REDIS_DB', 0, 15),
    password: password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

export function validateRedisEnvironment(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  createRedisConnectionOptions({
    REDIS_HOST:
      typeof environment.REDIS_HOST === 'string'
        ? environment.REDIS_HOST
        : undefined,
    REDIS_PORT:
      typeof environment.REDIS_PORT === 'string' ||
      typeof environment.REDIS_PORT === 'number'
        ? environment.REDIS_PORT
        : undefined,
    REDIS_PASSWORD:
      typeof environment.REDIS_PASSWORD === 'string'
        ? environment.REDIS_PASSWORD
        : undefined,
    REDIS_DB:
      typeof environment.REDIS_DB === 'string' ||
      typeof environment.REDIS_DB === 'number'
        ? environment.REDIS_DB
        : undefined,
  });
  createAiAnalysisDefaultJobOptions(
    typeof environment.AI_JOB_ATTEMPTS === 'string' ||
      typeof environment.AI_JOB_ATTEMPTS === 'number'
      ? environment.AI_JOB_ATTEMPTS
      : undefined,
  );

  return environment;
}
