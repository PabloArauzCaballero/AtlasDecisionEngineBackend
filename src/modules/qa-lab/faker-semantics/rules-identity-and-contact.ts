import { genderCandidates, persona, phoneCandidates, section } from './candidates';
import { NAME, all, any, either } from './matchers';
import { RuleDefinition } from './types';

export const RULES_IDENTITY_AND_CONTACT: readonly RuleDefinition[] = [
  // Nombres.
  {
    field: 'persona.fullName',
    type: 'caso',
    matches: all(NAME, any('completo', 'full')),
    pick: persona('fullName'),
  },
  {
    field: 'persona.secondName',
    type: 'caso',
    matches: either(all(any('segundo', 'second'), NAME), any('middle')),
    pick: persona('secondName'),
  },
  {
    field: 'persona.secondLastName',
    type: 'caso',
    matches: either(all(any('segundo', 'second'), any('apellido', 'last')), any('materno')),
    pick: persona('secondLastName'),
  },
  {
    field: 'persona.lastNames',
    type: 'caso',
    matches: any('apellidos'),
    pick: (record) => {
      const person = section(record, 'persona');
      return [`${String(person.lastName ?? '')} ${String(person.secondLastName ?? '')}`.trim()];
    },
  },
  {
    field: 'persona.lastName',
    type: 'caso',
    matches: either(any('apellido', 'surname', 'paterno', 'lastname'), all(any('last'), NAME)),
    pick: persona('lastName'),
  },
  {
    field: 'persona.firstName',
    type: 'caso',
    matches: either(all(any('primer', 'first'), NAME), any('firstname', 'nombres')),
    pick: (record) => {
      const person = section(record, 'persona');
      return [person.firstName];
    },
  },
  { field: 'persona.fullName', type: 'caso', matches: NAME, pick: persona('fullName') },

  // Documento de identidad.
  {
    field: 'persona.documentType',
    type: 'caso',
    matches: all(any('tipo', 'type'), any('documento', 'document', 'doc')),
    pick: persona('documentType'),
  },
  {
    field: 'persona.documentComplement',
    type: 'caso',
    matches: any('complemento', 'complement'),
    pick: persona('documentComplement'),
  },
  {
    field: 'persona.documentExtension',
    type: 'caso',
    matches: any('extension', 'expedido', 'expedicion', 'ext'),
    pick: persona('documentExtension'),
  },
  {
    field: 'persona.documentNumber',
    type: 'caso',
    matches: any('ci', 'carnet', 'cedula', 'documento', 'document', 'dni', 'identificacion'),
    pick: persona('documentNumber'),
  },

  // Contacto.
  {
    field: 'persona.phoneOperator',
    type: 'caso',
    matches: any('operador', 'operator'),
    pick: persona('phoneOperator'),
  },
  {
    field: 'persona.phone',
    type: 'caso',
    matches: any('telefono', 'celular', 'phone', 'movil', 'mobile', 'whatsapp', 'tel', 'cel'),
    pick: (record) => phoneCandidates(section(record, 'persona').phone),
  },
  {
    field: 'persona.email',
    type: 'caso',
    matches: any('email', 'correo', 'mail'),
    pick: persona('email'),
  },
  {
    field: 'persona.gender',
    type: 'caso',
    matches: any('genero', 'sexo', 'gender', 'sex'),
    pick: (record) => genderCandidates(section(record, 'persona').gender),
  },
];
