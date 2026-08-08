/**
 * Fábrica de adaptadores de persistencia.
 *
 * Un adaptador concreto no resuelve su propia conexión ni comprueba sus propias
 * capacidades: pide un asa a esta fábrica en su constructor y, si la ruta declarada para
 * su módulo es imposible, el contenedor de Nest no llega a levantarse. Es la diferencia
 * entre enterarse al arrancar y enterarse en la primera petición.
 *
 * No hay `switch` por motor repartido por el código: la resolución del motor y del
 * proveedor vive en el registro, y la traducción de capacidades en `adapter-capabilities`.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { UnsupportedCapabilityError } from '../errors/persistence-errors';
import type { CapabilityName } from '../ports/adapter-capabilities';
import { missingCapabilities } from '../ports/adapter-capabilities';
import type {
  ConsistencyLevel,
  DataEngine,
  ReadContext,
  TransactionContext,
} from '../ports/data-source.types';
import {
  DataSourceRouterService,
  type ResolvedDataSource,
} from '../routing/data-source-router.service';
import { type ReadClient, ReadPathService } from '../adapters/postgres/read-path.service';
import { WritePathService } from '../adapters/postgres/write-path.service';
import type { PrismaService } from '../../prisma/prisma.service';

export interface AdapterDescriptor {
  /** Módulo lógico al que pertenece el adaptador; es la clave de las reglas de routing. */
  readonly module: string;
  /** Motor que el adaptador sabe hablar. Si la ruta resuelve a otro, no arranca. */
  readonly engine: DataEngine;
  /** Capacidades que este adaptador necesita de su motor. */
  readonly requires?: readonly CapabilityName[];
  readonly consistency?: ConsistencyLevel;
}

/** Asa de lectura: ejecuta consultas sobre la conexión que corresponda al módulo. */
export interface ReadAdapterHandle {
  run<T>(
    operation: string,
    query: (client: ReadClient) => Promise<T>,
    context?: ReadContext,
  ): Promise<T>;
  /** Ruta efectiva actual, para diagnóstico y para las pruebas del router. */
  describe(): ResolvedDataSource;
}

/** Asa de escritura: comandos y transacciones, siempre sobre el primario. */
export interface WriteAdapterHandle {
  run<T>(
    operation: string,
    command: (client: Prisma.TransactionClient | PrismaService) => Promise<T>,
    context?: TransactionContext,
  ): Promise<T>;
  transaction<T>(operation: (transaction: TransactionContext) => Promise<T>): Promise<T>;
  describe(): ResolvedDataSource;
}

@Injectable()
export class PersistenceAdapterFactory {
  constructor(
    private readonly router: DataSourceRouterService,
    private readonly reads: ReadPathService,
    private readonly writes: WritePathService,
  ) {}

  createReadAdapter(descriptor: AdapterDescriptor): ReadAdapterHandle {
    this.validate(descriptor, 'read');
    return {
      run: (operation, query, context) =>
        this.reads.run(descriptor.module, operation, query, {
          consistency: descriptor.consistency,
          ...context,
        }),
      // Se recalcula en cada llamada, no se congela: el interruptor de enrutamiento puede
      // devolver las lecturas al primario, y `describe()` debe contar lo que pasa ahora.
      describe: () => this.reads.resolve(descriptor.module, descriptor.consistency),
    };
  }

  createWriteAdapter(descriptor: AdapterDescriptor): WriteAdapterHandle {
    const resolved = this.validate(descriptor, 'write');
    return {
      run: (operation, command, context) =>
        this.writes.run(descriptor.module, operation, command, context),
      transaction: (operation) => this.writes.execute(operation),
      describe: () => resolved,
    };
  }

  /** Falla temprano y sin secretos: el mensaje nombra módulo, motor y capacidad, nunca la URL. */
  private validate(descriptor: AdapterDescriptor, operation: 'read' | 'write'): ResolvedDataSource {
    const resolved = this.router.resolve({
      module: descriptor.module,
      operation,
      consistency: descriptor.consistency,
    });
    if (resolved.engine !== descriptor.engine) {
      throw new UnsupportedCapabilityError(
        `Module "${descriptor.module}" routes ${operation} to a "${resolved.engine}" connection, but its adapter speaks "${descriptor.engine}"`,
        { connectionName: resolved.connectionName, engine: resolved.engine, operation },
      );
    }
    const missing = missingCapabilities(resolved.engine, descriptor.requires ?? []);
    if (missing.length) {
      throw new UnsupportedCapabilityError(
        `Module "${descriptor.module}" requires ${missing.join(', ')}, which "${resolved.engine}" does not provide`,
        { connectionName: resolved.connectionName, engine: resolved.engine, operation },
      );
    }
    return resolved;
  }
}
