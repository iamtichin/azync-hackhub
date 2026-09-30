import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { jest } from '@jest/globals';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { SolanaService } from './../src/modules/solana/solana.service';

describe('Application health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(SolanaService)
        .useValue({
          getHealth: jest
            .fn()
            .mockResolvedValue({ status: 'ok', network: 'devnet' }),
        })
        .compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    } catch (error) {
      if (app) await app.close();
      throw error;
    }
  }, 30_000);

  it('/solana/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/solana/health')
      .expect(200)
      .expect({ status: 'ok', network: 'devnet' });
  });

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);
});
