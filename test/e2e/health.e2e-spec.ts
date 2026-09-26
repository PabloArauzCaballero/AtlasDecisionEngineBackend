import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok without authentication', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('GET /health/ready reports dependency status', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks).toMatchObject({ database: 'ok' });
  });

  it('GET /health/data-sources reports both data paths and their routing', async () => {
    const response = await request(app.getHttpServer()).get('/health/data-sources').expect(200);

    // Las dos rutas se reportan por su nombre lógico aunque compartan pool: quien lee la
    // sonda conoce dos, y verlas colapsadas le haría creer que la de lectura no existe.
    expect(response.body.connections['postgres-write']).toMatchObject({
      status: 'up',
      role: 'write',
      engine: 'postgresql',
    });
    expect(response.body.connections['postgres-read']).toMatchObject({ status: 'up' });
    expect(response.body.routing['audit-query']).toMatchObject({ write: 'postgres-write' });
  });

  it('never discloses host, user or connection strings on a public probe', async () => {
    const response = await request(app.getHttpServer()).get('/health/data-sources').expect(200);
    const body = JSON.stringify(response.body);

    for (const secret of ['postgresql://', 'password', '@localhost', 'atlas_reader']) {
      expect(body).not.toContain(secret);
    }
  });
});
