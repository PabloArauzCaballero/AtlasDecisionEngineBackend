/** Shares hashing and key-rotation policy across compiler, audit and identity consumers. */
import { Global, Module } from '@nestjs/common';
import { HashService } from './hash.service';

@Global()
@Module({ providers: [HashService], exports: [HashService] })
export class CryptoModule {}
