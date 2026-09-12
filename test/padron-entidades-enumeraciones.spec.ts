import { FinancialInstitutionKind, InstitutionLicenseStatus } from '@prisma/client';
import { BOLIVIA_INSTITUTIONS } from '../src/modules/workers/bank-statement/core/institutions/bolivia-institutions';
import {
  INSTITUTION_KINDS,
  LICENSE_STATUSES,
} from '../src/modules/workers/bank-statement/institutions/financial-institution.dto';

/**
 * La nómina compilada, el enum de la base y el DTO tienen que decir lo MISMO.
 *
 * El defecto que esta prueba cierra no daba ningún error al compilar: `bolivia-institutions.ts`
 * incorporó cuatro situaciones del corte de ASFI —intervención, liquidación voluntaria, quiebra y
 * absorción— y ni el enum de Postgres ni el DTO se enteraron. Lo que se rompía estaba tres capas
 * más abajo y no se parecía a la causa: `POST …/institutions/seed` respondía 500 al llegar a la
 * primera entidad en quiebra y dejaba el padrón VACÍO; con el padrón vacío el motor cae a la
 * nómina compilada marcándose como NO autoritativo, la compuerta de emisor manda a revisión, y el
 * worker contestaba «no se pudo reconocer una entidad financiera boliviana compatible» sobre un
 * extracto perfectamente legible. Un fallo de carga que acusaba a la carátula.
 *
 * Se comprueba en los dos sentidos: un valor que la nómina usa y la base no admite rompe la
 * siembra; un valor que la base admite y la nómina no usa es un estado que nadie sabe interpretar.
 */
describe('padrón de entidades: la nómina, la base y el DTO declaran lo mismo', () => {
  const estadosDeLaBase = new Set<string>(Object.values(InstitutionLicenseStatus));
  const tiposDeLaBase = new Set<string>(Object.values(FinancialInstitutionKind));

  it('todo estado de licencia de la nómina existe en el enum de la base', () => {
    const usados = [
      ...new Set(BOLIVIA_INSTITUTIONS.map((entidad) => entidad.licenseStatus)),
    ].sort();
    expect(usados.filter((estado) => !estadosDeLaBase.has(estado))).toEqual([]);
  });

  it('todo tipo de entidad de la nómina existe en el enum de la base', () => {
    const usados = [...new Set(BOLIVIA_INSTITUTIONS.map((entidad) => entidad.kind))].sort();
    expect(usados.filter((tipo) => !tiposDeLaBase.has(tipo))).toEqual([]);
  });

  it('el DTO admite exactamente los estados que admite la base', () => {
    expect([...LICENSE_STATUSES].sort()).toEqual([...estadosDeLaBase].sort());
  });

  it('el DTO admite exactamente los tipos que admite la base', () => {
    expect([...INSTITUTION_KINDS].sort()).toEqual([...tiposDeLaBase].sort());
  });
});
