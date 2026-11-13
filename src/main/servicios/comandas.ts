// Comandas: lo que la cocina y la barra tienen que preparar.
//
// Cada vez que entra comida o bebida para preparar (una ronda de una mesa o un
// pedido de mostrador), se arma UNA comanda por sector: si la ronda trae dos
// hamburguesas y un café, la cocina ve las hamburguesas y la barra el café, y
// cada una avanza a su ritmo: en espera → preparando → lista → entregada.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BaseDeDatos } from '../db/conexion';
import { comandas, pedidos, usuarios } from '../db/esquema';
import type { Comanda, ComandaResumen, EstadoComanda, Sector } from '@compartido/tipos';
import { ESTADOS_COMANDA } from '@compartido/tipos';
import { ErrorDeUsuario } from './errores';
import { momentoLocal } from './fechas';
import type { LineaArmada, Tx } from './pedidos';
import { listarPedidos } from './pedidos';

type Lector = Pick<BaseDeDatos, 'select'>;

/** Arma las comandas de una ronda (una por sector que tenga algo para preparar). */
export function crearComandas(tx: Tx, pedidoId: number, ronda: number, lineas: LineaArmada[], ahora: Date): void {
  const sectores = new Set(lineas.map((l) => (l.producto.vaACocina ? (l.producto.sector ?? 'cocina') : null)).filter((s): s is Sector => s !== null));
  for (const sector of sectores) {
    tx.insert(comandas).values({ pedidoId, ronda, sector, creadaEn: momentoLocal(ahora) }).run();
  }
}

export function comandasDe(tx: Lector, pedidoIds: number[]): (ComandaResumen & { pedidoId: number })[] {
  if (pedidoIds.length === 0) return [];
  return tx
    .select({ id: comandas.id, pedidoId: comandas.pedidoId, ronda: comandas.ronda, sector: comandas.sector, estado: comandas.estado })
    .from(comandas)
    .where(inArray(comandas.pedidoId, pedidoIds))
    .orderBy(asc(comandas.ronda), asc(comandas.sector))
    .all();
}

/**
 * Lo que ve la pantalla de cocina: las comandas en espera, preparando y las
 * listas de la última hora que todavía no se entregaron. No muestra las de
 * pedidos anulados.
 */
export function listarComandas(db: BaseDeDatos, sector: Sector | 'todos', ahora: Date = new Date()): Comanda[] {
  const haceUnaHora = momentoLocal(new Date(ahora.getTime() - 60 * 60_000));
  const filas = db
    .select({
      id: comandas.id,
      pedidoId: comandas.pedidoId,
      ronda: comandas.ronda,
      sector: comandas.sector,
      estado: comandas.estado,
      creadaEn: comandas.creadaEn,
      empezadaEn: comandas.empezadaEn,
      listaEn: comandas.listaEn,
      mozoId: pedidos.mozoId,
      mozo: usuarios.nombre,
    })
    .from(comandas)
    .innerJoin(pedidos, eq(pedidos.id, comandas.pedidoId))
    .leftJoin(usuarios, eq(usuarios.id, pedidos.mozoId))
    .where(
      and(
        sql`${pedidos.estado} <> 'anulado'`,
        sector === 'todos' ? undefined : eq(comandas.sector, sector),
        sql`(${comandas.estado} IN ('pendiente', 'preparando') OR (${comandas.estado} = 'lista' AND ${comandas.listaEn} >= ${haceUnaHora}))`,
      ),
    )
    .orderBy(asc(comandas.creadaEn), asc(comandas.id))
    .all();
  if (filas.length === 0) return [];

  const detalles = new Map(listarPedidos(db, { ids: [...new Set(filas.map((f) => f.pedidoId))] }).map((p) => [p.id, p]));
  return filas.map((f) => {
    const p = detalles.get(f.pedidoId)!;
    return {
      ...f,
      numero: p.numero,
      tipo: p.tipo,
      mesa: p.mesaId !== null ? p.mesa : '',
      clienteNombre: p.clienteNombre,
      nota: p.nota,
      mozo: f.mozo ?? null,
      // Solo los renglones de esta ronda que se preparan en este sector.
      items: p.items.filter((i) => i.ronda === f.ronda && i.vaACocina && (i.sector ?? 'cocina') === f.sector),
    };
  });
}

/** Lo que hace falta para avisar (a la PC, a los celulares) que una comanda cambió. */
export interface ComandaCambiada {
  comandaId: number;
  estado: EstadoComanda;
  pedidoId: number;
  numero: number;
  mesa: string;
  sector: Sector;
  ronda: number;
  mozoId: number | null;
}

/**
 * Cambia el estado de una comanda. Se puede avanzar saltando pasos (una
 * gaseosa con hielo pasa directo a "lista") o volver UN paso atrás si alguien
 * se equivocó. Una entregada ya no vuelve.
 */
export function cambiarEstadoComanda(db: BaseDeDatos, id: number, estado: EstadoComanda, ahora: Date = new Date()): ComandaCambiada {
  return db.transaction((tx) => {
    const c = tx.select().from(comandas).where(eq(comandas.id, id)).get();
    if (!c) throw new ErrorDeUsuario('Esa comanda ya no existe.');
    const p = tx.select().from(pedidos).where(eq(pedidos.id, c.pedidoId)).get()!;
    if (p.estado === 'anulado') throw new ErrorDeUsuario(`El pedido #${p.numero} fue anulado: no hace falta prepararlo.`);
    const desde = ESTADOS_COMANDA.indexOf(c.estado);
    const hasta = ESTADOS_COMANDA.indexOf(estado);
    if (c.estado === 'entregada' && estado !== 'entregada') throw new ErrorDeUsuario('Esa comanda ya se entregó.');
    if (hasta < desde - 1) throw new ErrorDeUsuario('Solo se puede volver un paso atrás.');
    if (hasta !== desde) {
      const momento = momentoLocal(ahora);
      tx.update(comandas)
        .set({
          estado,
          // Cada momento queda anotado (sirve para medir tiempos de cocina). Al volver atrás, se borra.
          empezadaEn: hasta >= 1 ? (c.empezadaEn ?? momento) : null,
          listaEn: hasta >= 2 ? (hasta === desde + 1 || !c.listaEn ? momento : c.listaEn) : null,
          entregadaEn: hasta >= 3 ? momento : null,
        })
        .where(eq(comandas.id, id))
        .run();
      sincronizarPedido(tx, c.pedidoId);
    }
    return {
      comandaId: id,
      estado,
      pedidoId: c.pedidoId,
      numero: p.numero,
      mesa: p.mesaId !== null ? p.mesa : '',
      sector: c.sector,
      ronda: c.ronda,
      mozoId: p.mozoId,
    };
  });
}

/**
 * En los pedidos de mostrador, llevar y delivery, el tablero de Pedidos sigue
 * a la cocina: si algo se está preparando → "En preparación"; si todo está
 * listo → "Listo". (Las mesas no usan ese tablero: su cuenta sigue abierta.)
 */
function sincronizarPedido(tx: Tx, pedidoId: number): void {
  const p = tx.select({ estado: pedidos.estado, mesaId: pedidos.mesaId }).from(pedidos).where(eq(pedidos.id, pedidoId)).get();
  if (!p || p.mesaId !== null || p.estado === 'entregado' || p.estado === 'anulado') return;
  const estados = tx.select({ estado: comandas.estado }).from(comandas).where(eq(comandas.pedidoId, pedidoId)).all().map((c) => c.estado);
  if (estados.length === 0) return;
  const nuevo = estados.every((e) => e === 'lista' || e === 'entregada')
    ? 'listo'
    : estados.some((e) => e !== 'pendiente')
      ? 'en_preparacion'
      : 'pendiente';
  if (nuevo !== p.estado) tx.update(pedidos).set({ estado: nuevo }).where(eq(pedidos.id, pedidoId)).run();
}

/**
 * Y al revés: si en el tablero de Pedidos alguien marca el pedido como listo o
 * entregado (por ejemplo, la cocina no usa la pantalla), sus comandas lo siguen.
 */
export function seguirEstadoDelPedido(tx: Tx, pedidoId: number, estado: string, ahora: Date = new Date()): void {
  const momento = momentoLocal(ahora);
  if (estado === 'listo') {
    tx.update(comandas)
      .set({ estado: 'lista', listaEn: momento, empezadaEn: sql`coalesce(${comandas.empezadaEn}, ${momento})` })
      .where(and(eq(comandas.pedidoId, pedidoId), inArray(comandas.estado, ['pendiente', 'preparando'])))
      .run();
  } else if (estado === 'entregado') {
    tx.update(comandas)
      .set({ estado: 'entregada', entregadaEn: momento, listaEn: sql`coalesce(${comandas.listaEn}, ${momento})`, empezadaEn: sql`coalesce(${comandas.empezadaEn}, ${momento})` })
      .where(and(eq(comandas.pedidoId, pedidoId), sql`${comandas.estado} <> 'entregada'`))
      .run();
  }
}
