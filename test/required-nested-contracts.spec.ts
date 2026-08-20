/**
 * Un contrato anidado obligatorio que falta debe ser un 400, no un 500.
 *
 * `@ValidateNested()` no comprueba presencia: sobre `undefined` no hay objeto que recorrer y
 * class-validator lo da por bueno. La petición llegaba entonces al servicio sin contrato y
 * reventaba al leer un campo del objeto ausente, devolviendo `INTERNAL_ERROR`. Un 500 no es
 * catalogable ni corregible por quien llama, y además filtraba la consulta de Prisma y la
 * ruta del archivo compilado en el mensaje.
 *
 * Lo detectó el smoke integral (`authoring.variables-create.invalid.missing-initial-version`
 * y `authoring.calculated-fields-create-version.invalid.missing-return-contract`).
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateVariableDefinitionDto } from '../src/modules/variables/variable.dto';
import { CreateCalculatedFieldVersionDto } from '../src/modules/calculated-fields/calculated-field.dto';

function errorsFor<T extends object>(cls: new () => T, payload: Record<string, unknown>) {
  return validateSync(plainToInstance(cls, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('contratos anidados obligatorios', () => {
  const variablePayload = {
    variableCode: 'smoke_income',
    canonicalName: 'Ingreso mensual',
    businessDescription: 'Ingreso bruto mensual declarado.',
    dataClassification: 'INTERNAL',
    ownerTeam: 'RISK_DECISIONING',
    isSensitive: false,
  };

  it('rechaza una definición de variable sin versión inicial', () => {
    const errors = errorsFor(CreateVariableDefinitionDto, variablePayload);
    expect(errors.some((error) => error.property === 'initialVersion')).toBe(true);
  });

  it('acepta la misma definición cuando la versión inicial viaja completa', () => {
    const errors = errorsFor(CreateVariableDefinitionDto, {
      ...variablePayload,
      initialVersion: {
        dataType: 'DECIMAL',
        nullable: false,
        sources: [],
        validationRules: [],
      },
    });
    expect(errors).toHaveLength(0);
  });

  const versionPayload = {
    implementationKind: 'JAVASCRIPT',
    inputs: [],
    sourceCode: 'return 1;',
  };

  it('rechaza una versión de campo calculado sin contrato de retorno', () => {
    const errors = errorsFor(CreateCalculatedFieldVersionDto, versionPayload);
    expect(errors.some((error) => error.property === 'returns')).toBe(true);
  });

  it('acepta la misma versión cuando declara su contrato de retorno', () => {
    const errors = errorsFor(CreateCalculatedFieldVersionDto, {
      ...versionPayload,
      returns: {
        dataType: 'DECIMAL',
        nullable: false,
        nullConditions: [],
        divisionByZero: 'RETURN_DEFAULT',
        missingData: 'FAIL',
        outOfRange: 'FAIL',
        errorCode: 'SMOKE_ERROR',
      },
    });
    expect(errors).toHaveLength(0);
  });
});
