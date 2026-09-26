-- El padrón administrado no podía registrar cuatro situaciones que el corte de ASFI SÍ publica.
--
-- `bolivia-institutions.ts` declara siete estados de licencia desde que el corpus incorporó el
-- corte del 31.08.2026 —INTERVENED, VOLUNTARY_LIQUIDATION, BANKRUPTCY y ABSORBED además de los
-- tres originales—, pero el enum de la base se quedó con tres. La consecuencia no era cosmética:
-- `POST /v1/workers/bank-statement/institutions/seed`, que es como un despliegue nuevo puebla su
-- padrón, respondía 500 con «Invalid value for argument licenseStatus» al llegar a la primera
-- entidad en quiebra, y dejaba el padrón VACÍO. Con el padrón vacío `resolvedRegistry` cae a la
-- nómina compilada marcándose como NO autoritativa, la compuerta de emisor manda todo documento a
-- revisión con `padron-no-vigente`, y el worker acaba contestando «no se pudo reconocer una entidad
-- financiera boliviana compatible» sobre un extracto del BCP perfectamente legible. Un fallo de
-- carga disfrazado de acusación a la carátula.
--
-- `INTERVENED` no es un sinónimo de `REVOKED`: una intervención no implica revocación automática, y
-- afirmarla sería escribir en un expediente un hecho jurídico que nadie verificó (contradicción C02
-- del corpus). Por eso son valores propios y no un alias del que ya existía.
--
-- `IF NOT EXISTS` porque esta migración se aplica sobre bases que ya recibieron los valores a mano.
ALTER TYPE "InstitutionLicenseStatus" ADD VALUE IF NOT EXISTS 'INTERVENED';
ALTER TYPE "InstitutionLicenseStatus" ADD VALUE IF NOT EXISTS 'VOLUNTARY_LIQUIDATION';
ALTER TYPE "InstitutionLicenseStatus" ADD VALUE IF NOT EXISTS 'BANKRUPTCY';
ALTER TYPE "InstitutionLicenseStatus" ADD VALUE IF NOT EXISTS 'ABSORBED';
