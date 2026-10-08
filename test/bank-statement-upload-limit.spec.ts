import { Controller, INestApplication, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BANK_STATEMENT_MULTER_OPTIONS } from '../src/modules/workers/bank-statement/bank-statement-input';

@Controller('t')
class UploadProbeController {
  @Post()
  @UseInterceptors(FileInterceptor('file', BANK_STATEMENT_MULTER_OPTIONS))
  subir(@UploadedFile() file?: { size?: number }) {
    return { size: file?.size ?? 0 };
  }
}

describe('tope de multer en la subida de extractos', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('un archivo por encima del tope se corta con 413 antes de retenerlo entero', async () => {
    const res = await request(app.getHttpServer())
      .post('/t')
      .attach('file', Buffer.alloc(BANK_STATEMENT_MULTER_OPTIONS.limits.fileSize + 1024), 'x.pdf');
    expect(res.status).toBe(413);
  });

  it('un archivo dentro del tope pasa', async () => {
    const res = await request(app.getHttpServer())
      .post('/t')
      .attach('file', Buffer.from('%PDF-1.4 ok'), 'x.pdf');
    expect(res.status).toBe(201);
    expect(res.body.size).toBe(11);
  });
});
