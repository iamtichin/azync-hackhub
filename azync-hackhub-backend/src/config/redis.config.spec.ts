import {
  createRedisConnectionOptions,
  validateRedisEnvironment,
} from './redis.config';

describe('Redis configuration', () => {
  it('uses safe local defaults', () => {
    expect(createRedisConnectionOptions({})).toMatchObject({
      host: '127.0.0.1',
      port: 6379,
      db: 0,
      password: undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  });

  it('normalizes configured values', () => {
    expect(
      createRedisConnectionOptions({
        REDIS_HOST: ' redis.internal ',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: ' secret ',
        REDIS_DB: '2',
      }),
    ).toMatchObject({
      host: 'redis.internal',
      port: 6380,
      password: 'secret',
      db: 2,
    });
  });

  it.each([
    [{ REDIS_PORT: '0' }, 'REDIS_PORT'],
    [{ REDIS_PORT: 'not-a-port' }, 'REDIS_PORT'],
    [{ REDIS_DB: '16' }, 'REDIS_DB'],
  ])('rejects invalid numeric configuration', (environment, field) => {
    expect(() => createRedisConnectionOptions(environment)).toThrow(field);
  });

  it('fails validation during bootstrap for invalid Redis settings', () => {
    expect(() => validateRedisEnvironment({ REDIS_PORT: '70000' })).toThrow(
      'REDIS_PORT',
    );
  });

  it('fails validation during bootstrap for invalid queue attempts', () => {
    expect(() =>
      validateRedisEnvironment({ AI_JOB_ATTEMPTS: 'eleven' }),
    ).toThrow('AI_JOB_ATTEMPTS');
  });
});
