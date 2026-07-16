import type { Prisma } from '@prisma/client';

export interface VariableSeed {
  code: string;
  name: string;
  description: string;
  type: 'STRING' | 'BOOLEAN' | 'INTEGER' | 'NUMBER' | 'DATE' | 'DATETIME';
  sensitive?: boolean;
  validation?: Prisma.InputJsonValue;
}

export interface ReasonSeed {
  code: string;
  category: string;
  publicMessage: string;
  internalMessage: string;
  adverseAction: boolean;
}
