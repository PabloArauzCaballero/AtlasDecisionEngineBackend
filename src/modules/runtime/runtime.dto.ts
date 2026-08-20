/** Bounded decision request contract; caller input remains separate from engine-produced outputs. */
import { IsNotEmpty, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ExecuteDecisionDto {
  @IsString() @IsNotEmpty() @MaxLength(120) requestId!: string;
  @IsOptional() @IsString() @MaxLength(120) correlationId?: string;
  @IsString() @IsNotEmpty() @MaxLength(160) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(200) subjectReference?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_\-]{2,40}$/) environmentCode?: string;
  @IsObject() variables!: Record<string, unknown>;
  /**
   * De cuando es cada valor, por codigo de variable:
   * `{ ingresos: { observedAt: '2026-08-12T09:00:00Z', sourceVersion: 'buro-v3' } }`.
   *
   * Opcional, y lo seguira siendo: exigirlo de golpe romperia a todo integrador vivo. Lo que si
   * ocurre es que sin el, `age_seconds` queda nulo y el SLA de frescura no se puede comprobar —
   * y eso es MEDIBLE, que es el paso previo a poder exigirlo de verdad.
   */
  @IsOptional() @IsObject() variableMetadata?: Record<string, unknown>;
  @IsOptional() @IsObject() context?: Record<string, unknown>;
}
