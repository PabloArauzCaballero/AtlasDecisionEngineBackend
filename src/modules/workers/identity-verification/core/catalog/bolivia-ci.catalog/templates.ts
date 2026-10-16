import {
  DEPARTAMENTO_DE_NACIMIENTO,
  MRZ_EMISOR_BOL,
  NUMERO_IMPRESO,
  PAR_DE_FECHAS,
  ZONA_MRZ,
} from './back-anchors';
import {
  AUTORIDAD_SEGIP,
  CAMPO_APELLIDOS,
  CAMPO_DOMICILIO,
  CAMPO_EMISION,
  CAMPO_ESTADO_CIVIL,
  CAMPO_EXPIRACION,
  CAMPO_GRUPO_SANGUINEO,
  CAMPO_LUGAR_NACIMIENTO,
  CAMPO_NACIMIENTO,
  CAMPO_NOMBRES,
  CAMPO_NPIOC,
  CAMPO_OCUPACION,
  CAMPO_SECCION,
  CAMPO_SERIE,
  ESTADO_EMISOR,
  ROTULO_CEDULA,
} from './front-anchors';
import { BoliviaCiGeneration, PlantillaDeCedula } from './types';

export const PLANTILLA_DS_4924_2023: PlantillaDeCedula = {
  generacion: BoliviaCiGeneration.DS_4924_2023,
  nombre: 'Cédula de identidad del Bicentenario (DS 4924)',
  vigenteDesde: '2023-11-01',
  llevaMrz: true,
  codigoOptico: 'QR',
  // Cinco años para el común de los titulares; indefinida a partir de los 58 y
  // para personas con discapacidad grave; dos para el formato digital.
  vigenciaAnios: [2, 5],
  anclajes: [
    ESTADO_EMISOR,
    AUTORIDAD_SEGIP,
    ROTULO_CEDULA,
    CAMPO_NOMBRES,
    CAMPO_APELLIDOS,
    CAMPO_NACIMIENTO,
    CAMPO_EMISION,
    CAMPO_EXPIRACION,
    CAMPO_SERIE,
    CAMPO_SECCION,
    CAMPO_LUGAR_NACIMIENTO,
    CAMPO_DOMICILIO,
    CAMPO_ESTADO_CIVIL,
    CAMPO_OCUPACION,
    CAMPO_GRUPO_SANGUINEO,
    CAMPO_NPIOC,
    NUMERO_IMPRESO,
    PAR_DE_FECHAS,
    DEPARTAMENTO_DE_NACIMIENTO,
    ZONA_MRZ,
    MRZ_EMISOR_BOL,
  ],
};

export const PLANTILLA_PRE_2023: PlantillaDeCedula = {
  generacion: BoliviaCiGeneration.PRE_2023,
  nombre: 'Cédula de identidad anterior al DS 4924',
  vigenteDesde: '2011-01-01',
  llevaMrz: false,
  codigoOptico: 'QR',
  vigenciaAnios: [5, 10],
  anclajes: [
    ESTADO_EMISOR,
    AUTORIDAD_SEGIP,
    ROTULO_CEDULA,
    CAMPO_NOMBRES,
    CAMPO_APELLIDOS,
    CAMPO_NACIMIENTO,
    CAMPO_EXPIRACION,
    CAMPO_SERIE,
    CAMPO_SECCION,
    CAMPO_LUGAR_NACIMIENTO,
    CAMPO_DOMICILIO,
    CAMPO_ESTADO_CIVIL,
    CAMPO_OCUPACION,
    NUMERO_IMPRESO,
    PAR_DE_FECHAS,
    DEPARTAMENTO_DE_NACIMIENTO,
  ],
};

export const PLANTILLAS: readonly PlantillaDeCedula[] = [
  PLANTILLA_DS_4924_2023,
  PLANTILLA_PRE_2023,
];

/*
 * ── El número de cédula ────────────────────────────────────────────────────
 */
