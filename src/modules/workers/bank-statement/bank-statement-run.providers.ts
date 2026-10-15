import { BankStatementRunRecovery } from './bank-statement-run-recovery';
import { BankStatementRunStore } from './bank-statement-run.store';

/** Lo que el worker de fondo de extractos necesita además de sí mismo. */
export const BANK_STATEMENT_RUN_PROVIDERS = [BankStatementRunStore, BankStatementRunRecovery];
