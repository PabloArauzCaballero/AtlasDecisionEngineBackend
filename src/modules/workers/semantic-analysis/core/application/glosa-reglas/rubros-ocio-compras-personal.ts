import type { Regla } from './glosa-regla';

/**
 * Rubros de la capa 1 — Ocio, suscripciones, compras y cuidado personal.
 * Ver `glosa-rubros.ts` para el orden entre grupos, que importa.
 */
export const RUBROS_OCIO_COMPRAS_PERSONAL: readonly Regla[] = [
  // --- Ocio y suscripciones ------------------------------------------------
  {
    patron:
      /\b(?:NETFLIX|SPOTIFY|DISNEY|HBO|MAX\b|PRIME\s+VIDEO|YOUTUBE\s+PREMIUM|APPLE\.COM\/BILL|ICLOUD|GOOGLE\s*\*|MICROSOFT\s*\*|OPENAI|CHATGPT|CANVA|ADOBE|DROPBOX|SUSCRIPCION)\b/u,
    salida: ['GASTOS.OCIO.SUSCRIPCIONES', 'GASTOS.EMPRESARIALES.SOFTWARE'],
    entrada: [],
    porque: 'la glosa nombra una suscripción digital recurrente',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:AGENCIA\s+DE\s+VIAJES|BOA\b|AMASZONAS|ECOJET|LATAM|AVIANCA|COPA\s+AIRLINES|HOTEL|HOSTAL|BOOKING|DESPEGAR|PASAJE\s+AEREO|TICKET\s+AEREO)\b/u,
    salida: ['GASTOS.OCIO.VIAJES'],
    entrada: [],
    porque: 'la glosa nombra un viaje, un pasaje o un alojamiento',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CINE|CINEMARK|MULTICINE|TEATRO|CONCIERTO|ENTRADAS?\s+EVENTO|ESTADIO)\b/u,
    salida: ['GASTOS.OCIO.EVENTOS'],
    entrada: [],
    porque: 'la glosa nombra un espectáculo o evento',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:STEAM|PLAYSTATION|XBOX|NINTENDO|FREE\s*FIRE|ROBLOX|EPIC\s*GAMES|VIDEOJUEGO)\b/u,
    salida: ['GASTOS.OCIO.VIDEOJUEGOS'],
    entrada: [],
    porque: 'la glosa nombra una plataforma de videojuegos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CASINO|BINGO|APUESTA|LOTERIA|BETANO|BET365|TRAGAMONEDAS)\b/u,
    salida: ['GASTOS.OCIO.AZAR'],
    entrada: ['INGRESOS.RECOMPENSA'],
    porque: 'la glosa nombra un juego de azar',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:GIMNASIO|GYM|SMARTFIT|CLUB\s+SOCIAL|CLUB\s+DEPORTIVO|MEMBRESIA)\b/u,
    salida: ['GASTOS.PERSONAL.MEMBRESIAS', 'GASTOS.OCIO.CLUB'],
    entrada: [],
    porque: 'la glosa nombra una membresía o club',
    certeza: 'ALTA',
  },

  // --- Compras -------------------------------------------------------------
  {
    patron: /\b(?:AMAZON|ALIEXPRESS|SHEIN|TEMU|MERCADOLIBRE|EBAY|WISH)\b/u,
    salida: ['GASTOS.COMPRAS.TARJETA'],
    entrada: ['INGRESOS.REVERSO'],
    porque: 'la glosa nombra un comercio electrónico internacional',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:BOUTIQUE|ZAPATERIA|CALZADOS?|VESTIMENTA|ROPA|TEXTIL|MODA)\b/u,
    salida: ['GASTOS.COMPRAS.VESTIMENTA'],
    entrada: [],
    porque: 'la glosa nombra una tienda de ropa o calzado',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FERRETERIA|MUEBLERIA|ELECTROHOGAR|CASA\s+IDEAS|MULTICENTER|BAZAR)\b/u,
    salida: ['GASTOS.COMPRAS.HOGAR'],
    entrada: [],
    porque: 'la glosa nombra una tienda de artículos para el hogar',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LIBRERIA|PAPELERIA|IMPRENTA|FOTOCOPIAS)\b/u,
    salida: ['GASTOS.COMPRAS.LIBRERIA'],
    entrada: [],
    porque: 'la glosa nombra una librería o papelería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:COMPUTADORA|LAPTOP|CELULAR|SMARTPHONE|TECNOLOGIA|ELECTRONICA|INFORMATICA)\b/u,
    salida: ['GASTOS.COMPRAS.TECNOLOGIA'],
    entrada: [],
    porque: 'la glosa nombra la compra de tecnología',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:JOYERIA|RELOJERIA|ORFEBRERIA)\b/u,
    salida: ['GASTOS.COMPRAS.JOYERIA'],
    entrada: [],
    porque: 'la glosa nombra una joyería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:JUGUETERIA|JUGUETES)\b/u,
    salida: ['GASTOS.COMPRAS.JUGUETERIA'],
    entrada: [],
    porque: 'la glosa nombra una juguetería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:DEPORTES|MARATHON|ADIDAS|NIKE|PUMA\b|ARTICULOS\s+DEPORTIVOS)\b/u,
    salida: ['GASTOS.COMPRAS.DEPORTES'],
    entrada: [],
    porque: 'la glosa nombra una tienda deportiva',
    certeza: 'ALTA',
  },

  // --- Personal ------------------------------------------------------------
  {
    patron: /\b(?:PELUQUERIA|BARBERIA|SPA\b|SALON\s+DE\s+BELLEZA|ESTETICA|MANICURE)\b/u,
    salida: ['GASTOS.PERSONAL.CUIDADO'],
    entrada: [],
    porque: 'la glosa nombra un servicio de cuidado personal',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:VETERINARIA|PETSHOP|PET\s+SHOP|MASCOTAS|ALIMENTO\s+PARA\s+PERROS)\b/u,
    salida: ['GASTOS.PERSONAL.MASCOTAS'],
    entrada: [],
    porque: 'la glosa nombra un gasto de mascotas',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LAVANDERIA|TINTORERIA|LAVASECO)\b/u,
    salida: ['GASTOS.PERSONAL.LAVANDERIA'],
    entrada: [],
    porque: 'la glosa nombra una lavandería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FUNERARIA|CEMENTERIO|SEPELIO|VELATORIO)\b/u,
    salida: ['GASTOS.PERSONAL.FUNERARIA'],
    entrada: [],
    porque: 'la glosa nombra un servicio funerario',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:DONACION|APORTE\s+VOLUNTARIO|FUNDACION|IGLESIA|DIEZMO|ONG\b)\b/u,
    salida: ['GASTOS.PERSONAL.DONACIONES'],
    entrada: ['INGRESOS.SUBVENCION'],
    porque: 'la glosa declara una donación o aporte voluntario',
    certeza: 'ALTA',
  },
];
