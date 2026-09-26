/**
 * El paquete de EJEMPLO que se descarga de `GET /pdf/templates/format/example`.
 *
 * No es un «hola mundo». Es un template que funciona de verdad —se puede subir tal cual, se
 * publica y genera un PDF— y que además ejercita a propósito todo el vocabulario: cada tipo de
 * campo, obligatorios y opcionales, límites, un enum, una lista de objetos, el uso de los
 * parciales compartidos y un salto de página. Quien lo descarga tiene delante la respuesta a
 * «¿y cómo se declara una tabla?» sin tener que preguntarla.
 *
 * Está aquí, junto al compilador, y no en un `.json` suelto: una prueba comprueba que este
 * ejemplo PASA por el compilador. Si el formato cambia y el ejemplo no, la prueba se pone roja.
 * Un ejemplo que ya no vale es peor que no tener ejemplo, porque se copia igual.
 */
import type { TemplateBundle } from '../../domain/contracts/template-bundle';

export const EXAMPLE_TEMPLATE_BUNDLE: TemplateBundle = {
  manifest: {
    id: 'certificado-de-cuenta',
    version: '1.0.0',
    title: 'Certificado de cuenta',
    description:
      'Ejemplo completo del formato de paquete. Sirve como plantilla de partida: cámbiele el ' +
      'identificador, ajuste los campos y publíquelo.',
    tags: ['ejemplo', 'certificado'],
    classification: 'INTERNAL',
    page: { format: 'A4', orientation: 'portrait' },
    footer: {
      institutionalText: 'Documento emitido automáticamente. Verifique su validez con el ID.',
      showGeneratedAt: true,
      showDocumentId: true,
      showPageNumbers: true,
    },
  },

  // ── Contrato de datos ──────────────────────────────────────────────────────
  // Vocabulario cerrado: string · number · integer · boolean · enum · date · array · object.
  // Los límites no son opcionales en la práctica: son la cota del trabajo que una petición
  // puede provocar. Sin `maxItems`, un payload encarga un informe de mil páginas.
  fields: {
    titular: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 160,
      description: 'Nombre completo del titular de la cuenta',
    },
    documento: {
      type: 'string',
      required: true,
      maxLength: 40,
      description: 'Documento de identidad',
    },
    numeroCuenta: {
      type: 'string',
      required: true,
      maxLength: 34,
      description: 'Número de cuenta ya enmascarado por el emisor',
    },
    estado: {
      type: 'enum',
      required: true,
      values: ['ACTIVA', 'INACTIVA', 'CERRADA'],
      description: 'Situación de la cuenta',
    },
    saldo: {
      type: 'number',
      required: true,
      min: 0,
      max: 1000000000,
      description: 'Saldo disponible',
    },
    moneda: { type: 'string', required: true, maxLength: 3, description: 'ISO-4217, p. ej. BOB' },
    aperturaEl: { type: 'date', required: false, description: 'Fecha de apertura, ISO-8601' },
    tieneSobregiro: { type: 'boolean', required: false, description: 'Si admite sobregiro' },
    antiguedadMeses: { type: 'integer', required: false, min: 0, max: 1200 },
    movimientos: {
      type: 'array',
      required: false,
      maxItems: 500,
      description: 'Últimos movimientos; se imprimen como tabla',
      items: {
        type: 'object',
        fields: {
          fecha: { type: 'string', required: true, maxLength: 20 },
          concepto: { type: 'string', required: true, maxLength: 120 },
          importe: { type: 'number', required: true },
        },
      },
    },
    observaciones: {
      type: 'array',
      required: false,
      maxItems: 10,
      items: { type: 'string', maxLength: 400 },
    },
  },

  // ── Cuerpo ─────────────────────────────────────────────────────────────────
  // Sólo el CONTENIDO: el membrete, el pie, la numeración y la tipografía los pone el layout
  // base. Los datos viven bajo `data.` y los metadatos del documento bajo `document.`.
  //
  // Reglas que se comprueban al publicar y que rechazan el paquete si se incumplen:
  //   · nada de {{{ }}} ni {{& }} — el payload nunca puede convertirse en marcado
  //   · nada de parciales de nombre dinámico
  //   · sólo los ayudantes del catálogo: eq ne gt lt and or not inc cell join fallback
  //     fmtNumber fmtDate fmtDateTime fmtValue severity isEmpty
  //   · sólo los parciales compartidos: atlas/heading, atlas/summary, atlas/table,
  //     atlas/key-value-list, atlas/warning, atlas/section-header, atlas/signature,
  //     atlas/metadata
  template: `{{> atlas/heading title=document.title subtitle=data.titular}}

<div class="summary-row">
  {{> atlas/summary label='Saldo' value=data.saldo caption=data.moneda}}
  {{> atlas/summary label='Estado' value=data.estado}}
</div>

{{#if (eq data.estado 'CERRADA')}}
  {{> atlas/warning level='critical' title='Cuenta cerrada' text='Este certificado refleja una cuenta que ya no opera.'}}
{{/if}}

<section class="section">
  {{> atlas/section-header title='Datos de la cuenta'}}
  <div class="section__body">
    <div class="kv">
      <div class="kv__row">
        <span class="kv__label">Titular</span>
        <span class="kv__value">{{data.titular}}</span>
      </div>
      <div class="kv__row">
        <span class="kv__label">Documento</span>
        <span class="kv__value mono">{{data.documento}}</span>
      </div>
      <div class="kv__row">
        <span class="kv__label">Cuenta</span>
        <span class="kv__value mono">{{data.numeroCuenta}}</span>
      </div>
      {{#if data.aperturaEl}}
        <div class="kv__row">
          <span class="kv__label">Apertura</span>
          <span class="kv__value">{{fmtDate data.aperturaEl}}</span>
        </div>
      {{/if}}
      {{#if data.antiguedadMeses}}
        <div class="kv__row">
          <span class="kv__label">Antigüedad (meses)</span>
          <span class="kv__value">{{fmtValue data.antiguedadMeses}}</span>
        </div>
      {{/if}}
      <div class="kv__row">
        <span class="kv__label">Sobregiro</span>
        <span class="kv__value">{{fmtValue data.tieneSobregiro}}</span>
      </div>
    </div>
  </div>
</section>

{{#if data.movimientos}}
  <section class="section">
    {{> atlas/section-header title='Movimientos' description='Ordenados del más reciente al más antiguo.'}}
    <div class="section__body">
      <table class="table table--numeric">
        <thead>
          <tr><th scope="col">Fecha</th><th scope="col">Concepto</th><th scope="col">Importe</th></tr>
        </thead>
        <tbody>
          {{#each data.movimientos}}
            <tr>
              <td>{{this.fecha}}</td>
              <td>{{this.concepto}}</td>
              <td>{{fmtNumber this.importe 2}}</td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
  </section>
{{/if}}

{{#if data.observaciones}}
  <section class="section">
    {{> atlas/section-header title='Observaciones'}}
    <div class="section__body">
      <ol>{{#each data.observaciones}}<li>{{this}}</li>{{/each}}</ol>
    </div>
  </section>
{{/if}}

<footer class="doc-footnote">{{> atlas/metadata}}</footer>
`,

  // ── Estilos ────────────────────────────────────────────────────────────────
  // Sólo tokens. Un color escrito a mano sobrevive al cambio de marca y produce un documento
  // con dos identidades. Se rechazan `@import`, `url(https://…)` y marcado HTML.
  styles: `.section__body ol {
  margin: 0;
  padding-left: 6mm;
}

.summary-row .summary__value {
  font-size: var(--type-xl);
}
`,

  // ── Datos de ejemplo ───────────────────────────────────────────────────────
  // Obligatorios y VALIDADOS contra el contrato de arriba al publicar. Alimentan
  // `POST /pdf/preview`, así que un template no puede publicarse sin que exista una forma de
  // verlo impreso.
  sample: {
    titular: 'María José Núñez Peñaranda',
    documento: '7845219 LP',
    numeroCuenta: '****-****-****-4821',
    estado: 'ACTIVA',
    saldo: 12480.75,
    moneda: 'BOB',
    aperturaEl: '2019-03-14T10:00:00.000Z',
    tieneSobregiro: false,
    antiguedadMeses: 83,
    movimientos: [
      { fecha: '2026-02-10', concepto: 'Depósito en ventanilla', importe: 2500 },
      { fecha: '2026-02-08', concepto: 'Pago de servicios · electricidad', importe: -312.4 },
      { fecha: '2026-02-01', concepto: 'Abono de haberes', importe: 8900 },
    ],
    observaciones: [
      'El saldo mostrado corresponde al cierre del día indicado en el pie del documento.',
      'Los movimientos con importe negativo son cargos.',
    ],
  },
};
