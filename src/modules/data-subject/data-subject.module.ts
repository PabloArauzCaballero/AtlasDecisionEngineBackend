/** Derechos del titular sobre las decisiones automatizadas (LGPD arts. 18 y 20; CCPA/CPRA). */
import { Module } from '@nestjs/common';
import { DataSubjectController } from './data-subject.controller';
import { DataSubjectService } from './data-subject.service';

@Module({
  controllers: [DataSubjectController],
  providers: [DataSubjectService],
  exports: [DataSubjectService],
})
export class DataSubjectModule {}
