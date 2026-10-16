import { cooperativa } from './builders';
import { BoliviaInstitution } from './types';

/**
 * Cooperativas de ahorro y crédito abiertas y societarias (CAC).
 *
 * Son 41 y son el grupo más numeroso del padrón —con diferencia—, así que
 * también el que más documentos mandaba a «entidad desconocida» cuando faltaba:
 * el registro anterior sólo tenía cinco. Cada una se distingue
 * por el nombre entrecomillado con el que ASFI la registra.
 */
export const COOPERATIVAS: readonly BoliviaInstitution[] = [
  cooperativa(
    'CJN',
    'Cooperativa de Ahorro y Crédito Abierta "Jesús Nazareno" R.L.',
    String.raw`JES[UÚ]S\s+NAZARENO`,
  ),
  cooperativa(
    'CFA',
    'Cooperativa de Ahorro y Crédito Abierta "Fátima" R.L.',
    String.raw`F[AÁ]TIMA`,
  ),
  cooperativa(
    'CSM',
    'Cooperativa de Ahorro y Crédito Abierta "San Martín de Porres" R.L.',
    String.raw`SAN\s+MART[IÍ]N\s+DE\s+PORRES`,
  ),
  cooperativa(
    'CSA',
    'Cooperativa de Ahorro y Crédito Abierta "San Antonio" R.L.',
    String.raw`SAN\s+ANTONIO`,
  ),
  cooperativa(
    'CIH',
    'Cooperativa de Ahorro y Crédito Abierta "Inca Huasi" R.L.',
    String.raw`INCA\s+HUASI`,
  ),
  cooperativa(
    'CQC',
    'Cooperativa de Ahorro y Crédito Abierta "Quillacollo" R.L.',
    String.raw`QUILLACOLLO`,
  ),
  cooperativa(
    'CJP',
    'Cooperativa de Ahorro y Crédito Abierta "San José de Punata" R.L.',
    String.raw`SAN\s+JOS[EÉ]\s+DE\s+PUNATA`,
  ),
  cooperativa(
    'CMM',
    'Cooperativa de Ahorro y Crédito Abierta "Madre y Maestra" R.L.',
    String.raw`MADRE\s+Y\s+MAESTRA`,
  ),
  cooperativa('CLY', 'Cooperativa de Ahorro y Crédito Abierta "Loyola" R.L.', String.raw`LOYOLA`),
  cooperativa(
    'CPX',
    'Cooperativa de Ahorro y Crédito Abierta "Pío X" R.L.',
    String.raw`P[IÍ]O\s*X\b`,
  ),
  cooperativa(
    'CCR',
    'Cooperativa de Ahorro y Crédito Abierta "El Chorolque" R.L.',
    String.raw`EL\s+CHOROLQUE`,
  ),
  cooperativa(
    'CSP',
    'Cooperativa de Ahorro y Crédito Abierta "San Pedro" R.L.',
    String.raw`SAN\s+PEDRO\b(?!\s+DE\s+AIQUILE)`,
  ),
  cooperativa(
    'CCP',
    'Cooperativa de Ahorro y Crédito Abierta "Catedral" R.L.',
    String.raw`CATEDRAL\b(?!\s+DE\s+TARIJA)`,
  ),
  cooperativa(
    'CCM',
    'Cooperativa de Ahorro y Crédito Abierta "Comarapa" R.L.',
    String.raw`COMARAPA`,
  ),
  cooperativa(
    'CTR',
    'Cooperativa de Ahorro y Crédito Abierta "Trinidad" R.L.',
    String.raw`TRINIDAD`,
  ),
  cooperativa(
    'CEC',
    'Cooperativa de Ahorro y Crédito Abierta "Educadores Gran Chaco" R.L.',
    String.raw`EDUCADORES\s+GRAN\s+CHACO`,
  ),
  cooperativa(
    'CST',
    'Cooperativa de Ahorro y Crédito Abierta "San Mateo" R.L.',
    String.raw`SAN\s+MATEO`,
  ),
  cooperativa(
    'CMG',
    'Cooperativa de Ahorro y Crédito Abierta "Monseñor Félix Gainza" R.L.',
    String.raw`MONSE[NÑ]OR\s+F[EÉ]LIX\s+GAINZA`,
  ),
  cooperativa(
    'CMR',
    'Cooperativa de Ahorro y Crédito Abierta "Magisterio Rural" R.L.',
    String.raw`MAGISTERIO\s+RURAL\b(?!\s+DE\s+CHUQUISACA)`,
  ),
  cooperativa(
    'CJB',
    'Cooperativa de Ahorro y Crédito Abierta "San José de Bermejo" R.L.',
    String.raw`SAN\s+JOS[EÉ]\s+DE\s+BERMEJO`,
  ),
  cooperativa(
    'CJO',
    'Cooperativa de Ahorro y Crédito Abierta "San Joaquín" R.L.',
    String.raw`SAN\s+JOAQU[IÍ]N`,
  ),
  cooperativa(
    'CSR',
    'Cooperativa de Ahorro y Crédito Abierta "San Roque" R.L.',
    String.raw`SAN\s+ROQUE`,
  ),
  cooperativa(
    'CAS',
    'Cooperativa de Ahorro y Crédito Abierta "Asunción" R.L.',
    String.raw`ASUNCI[OÓ]N`,
  ),
  cooperativa(
    'CCA',
    'Cooperativa de Ahorro y Crédito Abierta "Catedral de Tarija" R.L.',
    String.raw`CATEDRAL\s+DE\s+TARIJA`,
  ),
  cooperativa(
    'CME',
    'Cooperativa de Ahorro y Crédito Abierta "La Merced" R.L.',
    String.raw`LA\s+MERCED`,
  ),
  cooperativa(
    'CCB',
    'Cooperativa de Ahorro y Crédito Abierta "San Carlos Borromeo" R.L.',
    String.raw`SAN\s+CARLOS\s+BORROMEO`,
  ),
  cooperativa('CCF', 'Cooperativa de Ahorro y Crédito Abierta "CACEF" R.L.', String.raw`CACEF`),
  cooperativa(
    'CPG',
    'Cooperativa de Ahorro y Crédito Abierta "Progreso" R.L.',
    String.raw`PROGRESO\b`,
  ),
  cooperativa(
    'CLS',
    'Cooperativa de Ahorro y Crédito Abierta "La Sagrada Familia" R.L.',
    String.raw`LA\s+SAGRADA\s+FAMILIA`,
  ),
  cooperativa(
    'CMD',
    'Cooperativa de Ahorro y Crédito Abierta "Magisterio Rural de Chuquisaca" R.L.',
    String.raw`MAGISTERIO\s+RURAL\s+DE\s+CHUQUISACA`,
  ),
  cooperativa(
    'CSN',
    'Cooperativa de Ahorro y Crédito Societaria "San Martín" R.L.',
    String.raw`SAN\s+MART[IÍ]N\b(?!\s+DE\s+PORRES)`,
  ),
  cooperativa(
    'CSQ',
    'Cooperativa de Ahorro y Crédito Abierta "San Pedro de Aiquile" R.L.',
    String.raw`SAN\s+PEDRO\s+DE\s+AIQUILE`,
  ),
  cooperativa(
    'CVE',
    'Cooperativa de Ahorro y Crédito Societaria "Virgen de los Remedios" R.L.',
    String.raw`VIRGEN\s+DE\s+LOS\s+REMEDIOS`,
  ),
  cooperativa(
    'CLO',
    'Cooperativa de Ahorro y Crédito Abierta "San Francisco Solano" R.L.',
    String.raw`SAN\s+FRANCISCO\s+SOLANO`,
  ),
  cooperativa(
    'CLC',
    'Cooperativa de Ahorro y Crédito Abierta "Solucredit San Silvestre" R.L.',
    String.raw`SOLUCREDIT\s+SAN\s+SILVESTRE`,
  ),
  cooperativa(
    'COO',
    'Cooperativa de Ahorro y Crédito Abierta "COOPROLE" R.L.',
    String.raw`COOPROLE`,
  ),
  cooperativa(
    'CEY',
    'Cooperativa de Ahorro y Crédito Abierta "Cristo Rey Cochabamba" R.L.',
    String.raw`CRISTO\s+REY`,
  ),
  cooperativa(
    'CPS',
    'Cooperativa de Ahorro y Crédito Abierta "Paulo VI" R.L.',
    String.raw`PAULO\s+VI\b`,
  ),
  cooperativa(
    'CUM',
    'Cooperativa de Ahorro y Crédito Societaria "Unión Santiago de Machaca USAMA" R.L.',
    String.raw`UNI[OÓ]N\s+SANTIAGO\s+DE\s+MACHACA|USAMA`,
  ),
  cooperativa(
    'CAE',
    'Cooperativa de Ahorro y Crédito Societaria "Cantera" R.L.',
    String.raw`CANTERA`,
  ),
  cooperativa(
    'CHO',
    'Cooperativa de Ahorro y Crédito Societaria "Hospicio" R.L.',
    String.raw`HOSPICIO`,
  ),
];
