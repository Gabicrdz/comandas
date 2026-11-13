// El salón: zonas, mesas en un plano y la cuenta de cada mesa.
//
// Idea central: la CUENTA de una mesa es un pedido tipo 'mesa' que queda
// abierto (sin cobrar) mientras la gente está sentada. Cada vez que piden algo
// más se agrega una RONDA a ese mismo pedido. Al cobrar, el pedido se cierra
// y la mesa queda libre. Así todo lo que ya hace la Caja (cobro, arqueo,
// reportes, ticket) sirve igual para las mesas.
import { and, asc, eq, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { BaseDeDatos } from '../db/conexion';
import { mesas, pedidoItems, pedidos, rondas, usuarios, zonas } from '../db/esquema';
import type { esquemaAbrirMesa, esquemaEditarCuenta, esquemaMesa, esquemaPosicion, esquemaRonda, esquemaZona } from '@compartido/esquemas';
import { lugarDisponible, primerLugarLibre, type MesaEnPlano } from '@compartido/salon';
import { pesos } from '@compartido/dinero';
import type { CuentaDeMesa, FormaMesa, Mesa, RondaAgregada, Salon, Usuario } from '@compartido/tipos';
import { ErrorDeUsuario } from './errores';
import { fechaLocal, horaLocal, momentoLocal } from './fechas';
import { armarLineas, guardarLineas, siguienteNumero } from './pedidos';
import { crearComandas } from './comandas';
import { guardarUsuario } from './usuarios';
import { obtenerMenu } from './menu';

type Lector = Pick<BaseDeDatos, 'select'>;
const ahoraSql = sql`(datetime('now', 'localtime'))`;

// ───────────────────────── Ver el salón ─────────────────────────

interface FilaCuenta {
  mesa_id: number;
  pedido_id: number;
  numero: number;
  comensales: number | null;
  mozo_id: number | null;
  mozo: string | null;
  abierta_en: string;
  total_centavos: number;
  unidades: number;
  rondas: number;
  ultima_ronda_en: string | null;
  cuenta_pedida_en: string | null;
}

/** Zonas, mesas (con su cuenta abierta, si tienen) y quiénes pueden atender. */
export function obtenerSalon(db: BaseDeDatos): Salon {
  const listaZonas = db
    .select({ id: zonas.id, nombre: zonas.nombre, orden: zonas.orden })
    .from(zonas)
    .where(eq(zonas.activa, true))
    .orderBy(asc(zonas.orden), asc(zonas.id))
    .all();
  const listaMesas = db
    .select({ id: mesas.id, zonaId: mesas.zonaId, nombre: mesas.nombre, lugares: mesas.lugares, forma: mesas.forma, x: mesas.x, y: mesas.y })
    .from(mesas)
    .where(eq(mesas.activa, true))
    .orderBy(asc(mesas.y), asc(mesas.x))
    .all();

  // Una sola consulta trae todas las cuentas abiertas con sus totales.
  const cuentas = db.$client
    .prepare(
      /* sql */ `
      SELECT p.mesa_id, p.id AS pedido_id, p.numero, p.comensales, p.mozo_id, u.nombre AS mozo,
             p.creado_en AS abierta_en, p.total_centavos, p.cuenta_pedida_en,
             (SELECT coalesce(sum(i.cantidad), 0) FROM pedido_items i WHERE i.pedido_id = p.id) AS unidades,
             (SELECT count(*) FROM rondas r WHERE r.pedido_id = p.id) AS rondas,
             (SELECT max(r.creada_en) FROM rondas r WHERE r.pedido_id = p.id) AS ultima_ronda_en
      FROM pedidos p
      LEFT JOIN usuarios u ON u.id = p.mozo_id
      WHERE p.mesa_id IS NOT NULL AND p.cobrado = 0 AND p.estado <> 'anulado'`,
    )
    .all() as FilaCuenta[];
  const porMesa = new Map(cuentas.map((c) => [c.mesa_id, c]));

  const conCuenta: Mesa[] = listaMesas.map((m) => {
    const c = porMesa.get(m.id);
    const cuenta: CuentaDeMesa | null = c
      ? {
          pedidoId: c.pedido_id,
          numero: c.numero,
          comensales: c.comensales,
          mozoId: c.mozo_id,
          mozo: c.mozo,
          abiertaEn: c.abierta_en,
          totalCentavos: c.total_centavos,
          unidades: Number(c.unidades),
          rondas: Number(c.rondas),
          ultimaRondaEn: c.ultima_ronda_en,
          cuentaPedidaEn: c.cuenta_pedida_en,
        }
      : null;
    return { ...m, estado: !cuenta ? 'libre' : cuenta.cuentaPedidaEn ? 'cuenta' : 'ocupada', cuenta };
  });

  const equipo = db
    .select({ id: usuarios.id, nombre: usuarios.nombre, rol: usuarios.rol })
    .from(usuarios)
    .where(eq(usuarios.activo, true))
    .orderBy(asc(usuarios.nombre))
    .all();
  // Los mozos primero; después el resto (en un local chico atiende el que cobra).
  const mozos = [...equipo.filter((u) => u.rol === 'mozo'), ...equipo.filter((u) => u.rol !== 'mozo')];

  return { zonas: listaZonas, mesas: conCuenta, mozos };
}

// ───────────────────────── Zonas ─────────────────────────

export function guardarZona(db: BaseDeDatos, datos: z.output<typeof esquemaZona>): number {
  return db.transaction((tx) => {
    const repetida = tx
      .select({ id: zonas.id })
      .from(zonas)
      .where(and(eq(zonas.activa, true), sql`${zonas.nombre} = ${datos.nombre} COLLATE NOCASE`))
      .get();
    if (repetida && repetida.id !== datos.id) throw new ErrorDeUsuario(`Ya hay una zona que se llama "${datos.nombre}".`);
    if (datos.id) {
      const r = tx.update(zonas).set({ nombre: datos.nombre }).where(and(eq(zonas.id, datos.id), eq(zonas.activa, true))).run();
      if (r.changes === 0) throw new ErrorDeUsuario('Esa zona ya no existe.');
      return datos.id;
    }
    const ultimo = tx.select({ orden: max(zonas.orden) }).from(zonas).get()?.orden ?? 0;
    return tx.insert(zonas).values({ nombre: datos.nombre, orden: ultimo + 1 }).returning({ id: zonas.id }).get().id;
  });
}

/** Solo se puede dar de baja una zona vacía (sin mesas). */
export function darDeBajaZona(db: BaseDeDatos, id: number): void {
  db.transaction((tx) => {
    const zona = tx.select().from(zonas).where(and(eq(zonas.id, id), eq(zonas.activa, true))).get();
    if (!zona) throw new ErrorDeUsuario('Esa zona ya no existe.');
    const conMesas = tx.select({ id: mesas.id }).from(mesas).where(and(eq(mesas.zonaId, id), eq(mesas.activa, true))).get();
    if (conMesas) throw new ErrorDeUsuario(`"${zona.nombre}" todavía tiene mesas. Pasalas a otra zona o borralas primero.`);
    const quedan = tx.select({ n: sql<number>`count(*)` }).from(zonas).where(eq(zonas.activa, true)).get()?.n ?? 0;
    if (Number(quedan) <= 1) throw new ErrorDeUsuario('Tiene que quedar al menos una zona.');
    tx.update(zonas).set({ activa: false }).where(eq(zonas.id, id)).run();
  });
}

// ───────────────────────── Mesas ─────────────────────────

function zonaActiva(tx: Lector, zonaId: number) {
  const zona = tx.select().from(zonas).where(and(eq(zonas.id, zonaId), eq(zonas.activa, true))).get();
  if (!zona) throw new ErrorDeUsuario('Esa zona ya no existe.');
  return zona;
}

function mesasDeZona(tx: Lector, zonaId: number): MesaEnPlano[] {
  return tx
    .select({ id: mesas.id, forma: mesas.forma, x: mesas.x, y: mesas.y })
    .from(mesas)
    .where(and(eq(mesas.zonaId, zonaId), eq(mesas.activa, true)))
    .all();
}

function mesaActiva(tx: Lector, id: number) {
  const mesa = tx.select().from(mesas).where(and(eq(mesas.id, id), eq(mesas.activa, true))).get();
  if (!mesa) throw new ErrorDeUsuario('Esa mesa ya no existe.');
  return mesa;
}

/** La cuenta abierta de una mesa (o undefined si está libre). */
function cuentaAbiertaDe(tx: Lector, mesaId: number) {
  return tx
    .select({ id: pedidos.id })
    .from(pedidos)
    .where(and(eq(pedidos.mesaId, mesaId), eq(pedidos.cobrado, false), sql`${pedidos.estado} <> 'anulado'`))
    .get();
}

/**
 * Crea o edita una mesa. Una mesa nueva va al primer casillero libre de su
 * zona; si al editar cambia de zona, también. Si cambia de forma (una larga
 * ocupa dos casilleros) y no entra donde está, avisa.
 */
export function guardarMesa(db: BaseDeDatos, datos: z.output<typeof esquemaMesa>): number {
  return db.transaction((tx) => {
    zonaActiva(tx, datos.zonaId);
    const repetida = tx
      .select({ id: mesas.id })
      .from(mesas)
      .where(and(eq(mesas.activa, true), sql`${mesas.nombre} = ${datos.nombre} COLLATE NOCASE`))
      .get();
    if (repetida && repetida.id !== datos.id) throw new ErrorDeUsuario(`Ya hay una mesa "${datos.nombre}".`);

    const otras = mesasDeZona(tx, datos.zonaId);
    if (!datos.id) {
      const lugar = primerLugarLibre(datos.forma, otras);
      if (!lugar) throw new ErrorDeUsuario('No queda lugar en esta zona. Mové o borrá alguna mesa, o creá otra zona.');
      return tx
        .insert(mesas)
        .values({ zonaId: datos.zonaId, nombre: datos.nombre, lugares: datos.lugares, forma: datos.forma, ...lugar })
        .returning({ id: mesas.id })
        .get().id;
    }

    const anterior = mesaActiva(tx, datos.id);
    let lugar = { x: anterior.x, y: anterior.y };
    if (anterior.zonaId !== datos.zonaId) {
      const libre = primerLugarLibre(datos.forma, otras, datos.id);
      if (!libre) throw new ErrorDeUsuario('No queda lugar en esa zona.');
      lugar = libre;
    } else if (!lugarDisponible(datos.forma, lugar, otras, datos.id)) {
      throw new ErrorDeUsuario(
        datos.forma === 'larga'
          ? 'Larga no entra ahí: ocupa dos casilleros y el de la derecha está ocupado (o es el borde). Movela primero.'
          : 'La mesa no entra en ese lugar.',
      );
    }
    tx.update(mesas)
      .set({ zonaId: datos.zonaId, nombre: datos.nombre, lugares: datos.lugares, forma: datos.forma, ...lugar })
      .where(eq(mesas.id, datos.id))
      .run();
    return datos.id;
  });
}

/** Arrastrar una mesa a otro casillero del plano (en su misma zona). */
export function moverMesa(db: BaseDeDatos, id: number, lugar: z.output<typeof esquemaPosicion>): void {
  db.transaction((tx) => {
    const mesa = mesaActiva(tx, id);
    if (!lugarDisponible(mesa.forma as FormaMesa, lugar, mesasDeZona(tx, mesa.zonaId), id)) {
      throw new ErrorDeUsuario('Ahí no entra: ese lugar está ocupado o se sale del plano.');
    }
    tx.update(mesas).set(lugar).where(eq(mesas.id, id)).run();
  });
}

/** Baja lógica: las cuentas viejas siguen apuntando a la mesa. No se puede con gente sentada. */
export function darDeBajaMesa(db: BaseDeDatos, id: number): void {
  db.transaction((tx) => {
    const mesa = mesaActiva(tx, id);
    if (cuentaAbiertaDe(tx, id)) throw new ErrorDeUsuario(`La mesa ${mesa.nombre} tiene una cuenta abierta. Cobrala o liberala antes.`);
    tx.update(mesas).set({ activa: false }).where(eq(mesas.id, id)).run();
  });
}

// ───────────────────────── Cuentas ─────────────────────────

function revisarMozo(tx: Lector, mozoId: number | null): void {
  if (mozoId === null) return;
  const mozo = tx.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, mozoId), eq(usuarios.activo, true))).get();
  if (!mozo) throw new ErrorDeUsuario('Ese mozo ya no está en el equipo. Elegí otro.');
}

/** La cuenta abierta (pedido de mesa sin cobrar). Si no se puede tocar, explica por qué. */
function cuentaParaCambiar(tx: Lector, pedidoId: number) {
  const pedido = tx.select().from(pedidos).where(eq(pedidos.id, pedidoId)).get();
  if (!pedido || pedido.mesaId === null) throw new ErrorDeUsuario('Esa cuenta no existe.');
  if (pedido.estado === 'anulado') throw new ErrorDeUsuario(`La cuenta de la mesa ${pedido.mesa} fue anulada.`);
  if (pedido.cobrado) throw new ErrorDeUsuario(`La cuenta de la mesa ${pedido.mesa} ya se cobró.`);
  return pedido;
}

function renglonesDe(tx: Lector, pedidoId: number): number {
  const fila = tx.select({ n: sql<number>`count(*)` }).from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)).get();
  return Number(fila?.n ?? 0);
}

/** "Se sentaron": abre la cuenta de la mesa (un pedido tipo mesa, todavía vacío). Devuelve su id. */
export function abrirMesa(
  db: BaseDeDatos,
  datos: z.output<typeof esquemaAbrirMesa>,
  usuario: Usuario | null,
  ahora: Date = new Date(),
): number {
  return db.transaction((tx) => {
    const mesa = mesaActiva(tx, datos.mesaId);
    if (cuentaAbiertaDe(tx, mesa.id)) throw new ErrorDeUsuario(`La mesa ${mesa.nombre} ya está ocupada.`);
    revisarMozo(tx, datos.mozoId);
    const fecha = fechaLocal(ahora);
    try {
      return tx
        .insert(pedidos)
        .values({
          numero: siguienteNumero(tx, fecha),
          fecha,
          hora: horaLocal(ahora),
          tipo: 'mesa',
          mesa: mesa.nombre,
          mesaId: mesa.id,
          comensales: datos.comensales,
          mozoId: datos.mozoId,
          subtotalCentavos: 0,
          totalCentavos: 0,
          cobrado: false,
          usuarioId: usuario?.id ?? null,
          creadoEn: momentoLocal(ahora),
        })
        .returning({ id: pedidos.id })
        .get().id;
    } catch (error) {
      // El índice único "una_cuenta_por_mesa" frena a dos personas abriendo la misma mesa a la vez.
      if (String(error).includes('UNIQUE')) throw new ErrorDeUsuario(`La mesa ${mesa.nombre} se acaba de ocupar.`);
      throw error;
    }
  });
}

/** Cambiar cuántos son o quién los atiende. */
export function editarCuenta(db: BaseDeDatos, pedidoId: number, datos: z.output<typeof esquemaEditarCuenta>): void {
  db.transaction((tx) => {
    cuentaParaCambiar(tx, pedidoId);
    revisarMozo(tx, datos.mozoId);
    tx.update(pedidos).set({ comensales: datos.comensales, mozoId: datos.mozoId, actualizadoEn: ahoraSql }).where(eq(pedidos.id, pedidoId)).run();
  });
}

/**
 * Suma una ronda a la cuenta: arma los renglones con los precios de la base,
 * los guarda con su número de ronda y actualiza el total. Si algo va a la
 * cocina, el pedido vuelve a "pendiente" (hay algo nuevo para preparar).
 */
export function agregarRonda(
  db: BaseDeDatos,
  pedidoId: number,
  datos: z.output<typeof esquemaRonda>,
  usuario: Usuario | null,
  ahora: Date = new Date(),
): RondaAgregada {
  return db.transaction((tx) => {
    const cuenta = cuentaParaCambiar(tx, pedidoId);
    const lineas = armarLineas(tx, datos.items);
    const rondaCentavos = lineas.reduce((s, l) => s + l.totalCentavos, 0);
    if (rondaCentavos !== datos.totalEsperadoCentavos) {
      throw new ErrorDeUsuario(
        `La ronda ahora suma ${pesos(rondaCentavos)}: alguien cambió precios del menú mientras la cargabas. Revisala y mandala de nuevo.`,
      );
    }
    const ultima = tx.select({ n: max(rondas.numero) }).from(rondas).where(eq(rondas.pedidoId, pedidoId)).get()?.n ?? 0;
    const ronda = ultima + 1;
    const renglones = renglonesDe(tx, pedidoId);
    tx.insert(rondas).values({ pedidoId, numero: ronda, creadaEn: momentoLocal(ahora), usuarioId: usuario?.id ?? null }).run();
    guardarLineas(tx, pedidoId, lineas, ronda, renglones);
    crearComandas(tx, pedidoId, ronda, lineas, ahora);

    const vaACocina = lineas.some((l) => l.producto.vaACocina);
    const totalCentavos = cuenta.totalCentavos + rondaCentavos;
    tx.update(pedidos)
      .set({
        subtotalCentavos: cuenta.subtotalCentavos + rondaCentavos,
        totalCentavos,
        // Si pidieron algo más, ya no están "esperando la cuenta".
        cuentaPedidaEn: null,
        ...(vaACocina ? { estado: 'pendiente' as const } : {}),
        actualizadoEn: ahoraSql,
      })
      .where(eq(pedidos.id, pedidoId))
      .run();
    return { ronda, rondaCentavos, totalCentavos, vaACocina };
  });
}

/** Marca (o desmarca) que la mesa pidió la cuenta: en el plano se pinta de amarillo. */
export function pedirCuenta(db: BaseDeDatos, pedidoId: number, pedida: boolean, ahora: Date = new Date()): void {
  db.transaction((tx) => {
    const cuenta = cuentaParaCambiar(tx, pedidoId);
    if (pedida && renglonesDe(tx, pedidoId) === 0) throw new ErrorDeUsuario(`La mesa ${cuenta.mesa} todavía no pidió nada.`);
    tx.update(pedidos).set({ cuentaPedidaEn: pedida ? momentoLocal(ahora) : null, actualizadoEn: ahoraSql }).where(eq(pedidos.id, pedidoId)).run();
  });
}

/**
 * Se sentaron y se fueron sin pedir nada: la cuenta vacía se anula con un
 * motivo automático (no se borra: el número del día no queda con un "hueco").
 * Con algo cargado, esto no sirve: hay que cobrar, o que el dueño anule.
 */
export function liberarMesa(db: BaseDeDatos, pedidoId: number, usuario: Usuario | null): void {
  db.transaction((tx) => {
    const cuenta = cuentaParaCambiar(tx, pedidoId);
    if (renglonesDe(tx, pedidoId) > 0) throw new ErrorDeUsuario(`La mesa ${cuenta.mesa} ya pidió: hay que cobrarla (o que el dueño anule la cuenta).`);
    tx.update(pedidos)
      .set({ estado: 'anulado', motivoAnulacion: 'Mesa liberada sin consumo', anuladoEn: ahoraSql, actualizadoEn: ahoraSql, anuladoPor: usuario?.id ?? null })
      .where(eq(pedidos.id, pedidoId))
      .run();
  });
}

// ───────────────────────── Salón de ejemplo ─────────────────────────

/** Plano de ejemplo: [nombre, x, y, forma, lugares]. */
const EJEMPLO: Record<string, [string, number, number, FormaMesa, number][]> = {
  Salón: [
    ['1', 0, 0, 'cuadrada', 4],
    ['2', 2, 0, 'cuadrada', 4],
    ['3', 4, 0, 'cuadrada', 4],
    ['4', 7, 0, 'larga', 8],
    ['5', 0, 2, 'redonda', 2],
    ['6', 2, 2, 'redonda', 2],
    ['7', 4, 2, 'cuadrada', 4],
    ['8', 7, 2, 'larga', 6],
    ['9', 0, 4, 'cuadrada', 4],
    ['10', 2, 4, 'cuadrada', 4],
    ['11', 4, 4, 'redonda', 2],
    ['12', 7, 4, 'larga', 8],
  ],
  Vereda: [
    ['V1', 0, 0, 'redonda', 2],
    ['V2', 2, 0, 'redonda', 2],
    ['V3', 4, 0, 'redonda', 2],
    ['V4', 6, 0, 'redonda', 2],
    ['V5', 0, 2, 'cuadrada', 4],
    ['V6', 2, 2, 'cuadrada', 4],
  ],
};

export interface ResultadoSalonEjemplo {
  mesas: number;
  mozos: { nombre: string; pin: string }[];
  abiertas: number;
}

/**
 * Arma un salón para probar o mostrar: 2 zonas, 18 mesas, 2 mozos y, si hay
 * menú, algunas mesas ya ocupadas con rondas. Solo si todavía no hay mesas.
 */
export function cargarSalonEjemplo(db: BaseDeDatos, usuario: Usuario, ahora: Date = new Date()): ResultadoSalonEjemplo {
  const yaHay = db.select({ id: mesas.id }).from(mesas).where(eq(mesas.activa, true)).get();
  if (yaHay) throw new ErrorDeUsuario('Ya hay mesas cargadas: el salón de ejemplo es solo para empezar de cero.');

  const mozosNuevos = [
    { nombre: 'Lucas', pin: '2222' },
    { nombre: 'Sofía', pin: '3333' },
  ].filter(
    (m) => !db.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.activo, true), sql`${usuarios.nombre} = ${m.nombre} COLLATE NOCASE`)).get(),
  );

  const idsMesas: number[] = [];
  db.transaction((tx) => {
    for (const [nombreZona, lista] of Object.entries(EJEMPLO)) {
      let zona = tx
        .select({ id: zonas.id })
        .from(zonas)
        .where(and(eq(zonas.activa, true), sql`${zonas.nombre} = ${nombreZona} COLLATE NOCASE`))
        .get();
      if (!zona) {
        const orden = (tx.select({ orden: max(zonas.orden) }).from(zonas).get()?.orden ?? 0) + 1;
        zona = tx.insert(zonas).values({ nombre: nombreZona, orden }).returning({ id: zonas.id }).get();
      }
      for (const [nombre, x, y, forma, lugares] of lista) {
        idsMesas.push(tx.insert(mesas).values({ zonaId: zona.id, nombre, x, y, forma, lugares }).returning({ id: mesas.id }).get().id);
      }
    }
  });
  const mozos = mozosNuevos.map((m) => ({ ...m, id: guardarUsuario(db, { nombre: m.nombre, rol: 'mozo', pin: m.pin }) }));
  const atienden = mozos.length > 0 ? mozos.map((m) => m.id) : [usuario.id];

  // Si hay productos simples (sin tamaños ni opciones obligatorias), ocupamos algunas mesas.
  const menu = obtenerMenu(db);
  const categorias = new Set(menu.categorias.filter((c) => c.activa).map((c) => c.id));
  const simples = menu.productos.filter(
    (p) =>
      p.disponible &&
      categorias.has(p.categoriaId) &&
      p.variantes.length === 0 &&
      p.gruposIds.every((g) => (menu.grupos.find((x) => x.id === g)?.minimo ?? 0) === 0),
  );
  let abiertas = 0;
  if (simples.length >= 3) {
    // [índice de mesa, comensales, minutos desde que se sentaron, rondas, ¿pidió la cuenta?]
    const plan: [number, number, number, number, boolean][] = [
      [0, 4, 52, 2, true],
      [2, 3, 25, 1, false],
      [3, 7, 40, 2, false],
      [6, 2, 12, 1, false],
      [12, 2, 34, 1, false],
    ];
    plan.forEach(([indice, comensales, minutos, cantidadRondas, cuenta], n) => {
      const mesaId = idsMesas[indice];
      if (mesaId === undefined) return;
      const abierta = new Date(ahora.getTime() - minutos * 60_000);
      const pedidoId = abrirMesa(db, { mesaId, comensales, mozoId: atienden[n % atienden.length]! }, usuario, abierta);
      for (let r = 0; r < cantidadRondas; r++) {
        const items = [0, 1, 2]
          .slice(0, r === 0 ? 3 : 2)
          .map((k) => simples[(indice + k * 3 + r * 5) % simples.length]!)
          .filter((p, i, todos) => todos.findIndex((q) => q.id === p.id) === i)
          .map((p, k) => ({ productoId: p.id, varianteId: null, opcionesIds: [], cantidad: k === 0 ? Math.max(1, Math.round(comensales / 2)) : 1, nota: '' }));
        const total = items.reduce((s, it) => s + menu.productos.find((p) => p.id === it.productoId)!.precioCentavos * it.cantidad, 0);
        const momento = new Date(abierta.getTime() + (3 + r * 18) * 60_000);
        agregarRonda(db, pedidoId, { items, totalEsperadoCentavos: total }, usuario, momento);
      }
      if (cuenta) pedirCuenta(db, pedidoId, true, new Date(ahora.getTime() - 4 * 60_000));
      abiertas++;
    });
  }
  return { mesas: Object.values(EJEMPLO).flat().length, mozos: mozosNuevos, abiertas };
}
