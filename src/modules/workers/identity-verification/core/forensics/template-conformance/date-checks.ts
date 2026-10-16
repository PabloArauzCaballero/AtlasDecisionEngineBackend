import type { Revision } from './revision';

const DIA_MS = 86_400_000;
const ANIO_MS = 365.2425 * DIA_MS;

export function revisarFechas(revision: Revision): void {
  const { campos, mrz, ahora } = revision.entrada;
  const { conformidad, fallos } = revision;

  // --- 3. Las fechas son coherentes entre sí -------------------------------
  const nacimiento = aFecha(campos.dateOfBirth?.value);
  const emision = aFecha(campos.issueDate?.value);
  const caducidad = aFecha(campos.expirationDate?.value);

  if (nacimiento && caducidad && caducidad.getTime() <= nacimiento.getTime()) {
    fallos.push({
      codigo: 'DATE_ORDER_IMPOSSIBLE',
      detalle: 'La fecha de expiración es anterior o igual a la de nacimiento.',
      peso: 0.4,
    });
  }
  if (emision && caducidad && caducidad.getTime() <= emision.getTime()) {
    fallos.push({
      codigo: 'ISSUE_AFTER_EXPIRY',
      detalle: 'La fecha de emisión es posterior a la de expiración.',
      peso: 0.4,
    });
  }
  if (nacimiento && nacimiento.getTime() > ahora.getTime()) {
    fallos.push({
      codigo: 'BIRTH_DATE_IN_FUTURE',
      detalle: 'La fecha de nacimiento es futura.',
      peso: 0.4,
    });
  }
  /*
   * Una EMISIÓN futura.
   *
   * Se comprobaba el nacimiento y no la emisión, y la emisión es la que un
   * montaje toca: se parte de una cédula caducada y se le adelantan las fechas
   * para que parezca vigente. Adelantar la emisión es el descuido más fácil de
   * cometer y el más fácil de comprobar — el SEGIP no expide documentos con
   * fecha de mañana.
   *
   * Se dan dos días de margen por la zona horaria: el motor trabaja en UTC y la
   * tarjeta se imprimió en Bolivia (UTC−4), así que una cédula emitida hoy mismo
   * no debe acusarse por unas horas de desfase.
   */
  if (emision && emision.getTime() > ahora.getTime() + 2 * DIA_MS) {
    fallos.push({
      codigo: 'ISSUE_DATE_IN_FUTURE',
      detalle: 'La fecha de emisión es posterior a hoy.',
      /*
       * Pesa 0,2 y no más porque la emisión es el campo menos demostrable de la
       * tarjeta: no está en la MRZ, así que no hay dígito de control que la
       * respalde, y va impresa en el cuerpo más pequeño del anverso. Ver, más
       * abajo, la comprobación de vigencia que se retiró por ese mismo motivo.
       * Aquí la condición sí es imposible —el SEGIP no expide con fecha de
       * mañana— pero un año mal leído la produce, así que escala y no acusa.
       */
      peso: 0.2,
    });
  }

  /*
   * Vigencias imposibles.
   *
   * La tarjeta física dura cinco años; el DS 4342 llegó a ampliarla a diez, y a
   * partir de los 58 años puede ser indefinida —que en la práctica se imprime
   * con una caducidad muy lejana—. Así que el tope se pone en 60 años, muy por
   * encima de cualquier caso legítimo: lo que esto atrapa es la caducidad
   * inventada de un montaje («válida hasta 2099»), no una vigencia larga real.
   */
  if (emision && caducidad) {
    const anios = (caducidad.getTime() - emision.getTime()) / ANIO_MS;
    if (anios > 60) {
      fallos.push({
        codigo: 'VALIDITY_SPAN_IMPLAUSIBLE',
        detalle: `Entre la emisión y la expiración hay ${anios.toFixed(0)} años, muy por encima de cualquier vigencia que el SEGIP emita.`,
        peso: 0.3,
      });
    }
    /*
     * Aquí se PROBÓ un corte por vigencia no estándar —5 o 10 años, que es lo
     * que el SEGIP expide— y se retiró, medido.
     *
     * La idea era buena: el tope de sesenta años atrapa el «válida hasta 2099»
     * de un montaje torpe y deja pasar el que importa, que es adelantar la
     * caducidad de una cédula vencida un par de años. El problema es de qué
     * DATOS dispone para juzgar. La caducidad suele venir de la MRZ y trae
     * dígito de control; la EMISIÓN no está en la MRZ y sólo existe impresa, en
     * el cuerpo más pequeño del anverso y sobre el guilloché. O sea que la
     * vigencia se calcula restando un dato demostrado menos un dato no
     * demostrado.
     *
     * Sobre cinco cédulas bolivianas auténticas, la comprobación acusó a una: su
     * anverso imprime `23/06/2026` y el reconocedor devolvió `23/08/2020`, de
     * modo que una tarjeta de cinco años de vigencia parecía tener once. Una de
     * cada cinco cédulas legítimas marcada por el campo que peor se lee no es
     * una defensa contra el fraude: es una cola de revisión.
     *
     * Vuelve a tener sentido el día que la emisión se pueda demostrar —un QR
     * leído, un cotejo contra el SEGIP— y no antes.
     */
  }

  /*
   * La generación VIGENTE sin zona de lectura mecánica.
   *
   * El DS 4924 de 2023 rediseñó la cédula y la MRZ TD1 del reverso es parte del
   * diseño: una tarjeta de esa generación la lleva siempre. Un falsificador que
   * reproduce el anverso —los rótulos, el guilloché, el retrato— se salta la MRZ
   * con frecuencia, porque exige calcular tres dígitos de control que nadie mira
   * a simple vista.
   *
   * Sólo se levanta cuando se fotografió el REVERSO. Sin reverso, la MRZ falta
   * por no haberse fotografiado y no por no existir, que es una captura legítima
   * y frecuente. Y pesa poco —0,2— porque la otra explicación es honesta y
   * corriente: la MRZ es la letra más pequeña de la tarjeta y una foto regular la
   * pierde entera. Es una señal para escalar, nunca para rechazar.
   */
  if (
    conformidad.generacion === 'DS_4924_2023' &&
    revision.entrada.textoReverso.trim().length > 0 &&
    !mrz
  ) {
    fallos.push({
      codigo: 'MRZ_ABSENT_ON_CURRENT_GENERATION',
      detalle:
        'La tarjeta tiene el diseño vigente (DS 4924 de 2023), que lleva zona de lectura mecánica, y en el reverso fotografiado no se encontró ninguna.',
      peso: 0.2,
    });
  }

  /*
   * Un titular con menos de dieciséis años.
   *
   * No es imposible —el SEGIP emite cédula a menores— pero SÍ lo es para el
   * flujo que llama a este worker, que es el alta de un producto financiero. Se
   * anota como incoherencia con peso bajo para que escale a una persona, y no
   * como rechazo: quien decide si un menor puede contratar es la política del
   * artefacto, no el lector del documento.
   */
  if (nacimiento) {
    const edad = (ahora.getTime() - nacimiento.getTime()) / ANIO_MS;
    if (edad < 16) {
      fallos.push({
        codigo: 'HOLDER_UNDERAGE',
        detalle: `El documento declara un titular de ${edad.toFixed(0)} años.`,
        peso: 0.2,
      });
    }
    if (edad > 120) {
      fallos.push({
        codigo: 'HOLDER_AGE_IMPLAUSIBLE',
        detalle: `El documento declara un titular de ${edad.toFixed(0)} años.`,
        peso: 0.35,
      });
    }
  }
}

/** Una fecha ISO del analizador, como fecha UTC. `null` si no hay o no se puede. */
function aFecha(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
