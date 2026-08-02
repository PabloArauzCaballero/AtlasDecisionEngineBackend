/** Makes the tenant-aware Redis/cache policy shared instead of reimplemented per domain. */
import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';

@Global()
@Module({ providers: [CacheService], exports: [CacheService] })
export class CacheModule {}
