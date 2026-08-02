/**
 * Carries correlation and trusted identity through async call chains without retaining request
 * bodies, enabling structured logs and transaction-local tenant RLS.
 */
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApiAudience, AuthMethod } from '../security/security.types';

export interface RequestContextStore {
  requestId: string;
  startedAt: number;
  tenantId?: string;
  principalId?: string;
  audience?: ApiAudience;
  authMethod?: AuthMethod;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  enrich(values: Partial<RequestContextStore>): void {
    const store = this.storage.getStore();
    if (store) Object.assign(store, values);
  }
}
