import { direccion, dispositivo, finanzas, persona, snapshot } from './candidates';
import { all, any, either } from './matchers';
import { RuleDefinition } from './types';

export const RULES_LOCATION_FINANCE_DEVICE: readonly RuleDefinition[] = [
  // Dirección.
  {
    field: 'direccion.departmentCode',
    type: 'caso',
    matches: all(any('departamento', 'department'), any('codigo', 'code', 'cod')),
    pick: direccion('departmentCode'),
  },
  {
    field: 'direccion.department',
    type: 'caso',
    matches: any('departamento', 'department', 'region'),
    pick: (record) => [...direccion('department')(record), ...direccion('departmentCode')(record)],
  },
  {
    field: 'direccion.city',
    type: 'caso',
    matches: any('ciudad', 'city', 'municipio', 'localidad'),
    pick: direccion('city'),
  },
  {
    field: 'direccion.zone',
    type: 'caso',
    matches: any('zona', 'barrio'),
    pick: direccion('zone'),
  },
  {
    field: 'direccion.country',
    type: 'caso',
    matches: any('pais', 'country'),
    pick: (record) => [...direccion('country')(record), 'Bolivia'],
  },
  {
    field: 'direccion.latitude',
    type: 'caso',
    matches: any('lat', 'latitud', 'latitude'),
    pick: direccion('latitude'),
  },
  {
    field: 'direccion.longitude',
    type: 'caso',
    matches: any('lon', 'lng', 'longitud', 'longitude'),
    pick: direccion('longitude'),
  },
  {
    field: 'persona.address',
    type: 'caso',
    matches: any('direccion', 'address', 'domicilio', 'calle'),
    pick: persona('address'),
  },

  // Finanzas.
  {
    field: 'perfilFinanciero.monthlyExpenses',
    type: 'caso',
    matches: any('gasto', 'gastos', 'egreso', 'egresos', 'expense', 'expenses'),
    pick: finanzas('monthlyExpenses'),
  },
  {
    field: 'perfilFinanciero.monthlyIncome',
    type: 'caso',
    matches: any('ingreso', 'ingresos', 'income', 'salario', 'sueldo', 'salary'),
    pick: finanzas('monthlyIncome'),
  },
  {
    field: 'perfilFinanciero.currency',
    type: 'caso',
    matches: any('moneda', 'currency', 'divisa'),
    pick: finanzas('currency'),
  },

  // Dispositivo.
  {
    field: 'dispositivo.deviceFingerprintHash',
    type: 'caso',
    matches: any('fingerprint', 'huella'),
    pick: dispositivo('deviceFingerprintHash'),
  },
  {
    field: 'dispositivo.userAgent',
    type: 'caso',
    matches: either(any('useragent'), all(any('user'), any('agent'))),
    pick: dispositivo('userAgent'),
  },
  {
    field: 'dispositivo.channel',
    type: 'caso',
    matches: any('canal', 'channel'),
    pick: dispositivo('channel'),
  },
  {
    field: 'dispositivo.isRooted',
    type: 'caso',
    matches: any('rooted', 'root', 'jailbreak'),
    pick: snapshot('isRooted'),
  },
  {
    field: 'dispositivo.isEmulator',
    type: 'caso',
    matches: any('emulador', 'emulator'),
    pick: snapshot('isEmulator'),
  },
  { field: 'dispositivo.vpn', type: 'caso', matches: any('vpn'), pick: snapshot('vpnDetected') },
  {
    field: 'dispositivo.osFamily',
    type: 'caso',
    matches: any('plataforma', 'platform'),
    pick: snapshot('osFamily'),
  },
];
