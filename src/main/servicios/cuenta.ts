// La cuenta de una mesa, después de pedir: propina, sacar algo, pasar la
// cuenta a otra mesa y juntar dos mesas. Todo vale solo mientras la cuenta
// está abierta (sin cobrar).
import { and, eq, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { BaseDeDatos } from '../db/conexion';
import { comandas, itemsQuitados, pedidoItemAgregados, pedidoItems, pedidos, rondas } from '../db/esquema';
import type { esquemaQuitarItem } from '@compartido/esquemas';
import { pesos } from '@compartido/dinero';
import type { Usuario } from '@compartido/tipos';
import { ErrorDeUsuario } from './errores';
import { momentoLocal } from './fechas';
import { cuentaAbiertaDe, cuentaParaCambiar, mesaActiva, renglonesDe } from './salon';

const ahoraSql = sql`(datetime('now', 'localtime'))`;

// ───────────────────────── Propina ─────────────────────────

/**
 * Pone la propina de la cuenta (0 la saca). Es PARTE del total que se cobra,
 * pero los reportes la muestran aparte: no es una venta del local.
 */
export function fijarPropina(db: BaseDeDatos, pedidoId: number, propinaCentavos: number): number {
  return db.transaction((tx) => {
    const cuenta = cuentaParaCambiar(tx, pedidoId);
    if (renglonesDe(tx, pedidoId) === 0) throw new ErrorDeUsuario(`La mesa ${cuenta.mesa} todavía no pidió nada.`);
    if (propinaCentavos > cuenta.subtotalCentavos) {
      throw new ErrorDeUsuario(`La propina no puede ser más que el consumo (${pesos(cuenta.subtotalCentavos)}).`);
    }
    const totalCentavos = cuenta.subtotalCentavos + cuenta.envioCentavos + propinaCentavos;
    tx.update(pedidos).set({ propinaCentavos, totalCentavos, actualizadoEn: ahoraSql }).where(eq(pedidos.id, pedidoId)).run();
    return totalCentavos;
  });
}

// ───────────────────────── Sacar algo de la cuenta ─────────────────────────

/**
 * Saca unidades de un renglón (o el renglón entero). Solo el dueño, y con
 * motivo: queda anotado en `items_quitados` para que se pueda revisar después.
 * Si lo que se saca era lo único que esperaba la cocina o la barra, esa
 * comanda se borra de su pantalla (si ya estaba lista, se deja).
 */
export function quitarItem(
  db: BaseDeDatos,
  pedidoId: number,
  datos: z.output<typeof esquemaQuitarItem>,
  usuario: Usuario,
  ahora: Date = new Date(),
): { montoCentavos: number; totalCentavos: number } {
  if (usuario.rol !== 'dueno') throw new ErrorDeUsuario('Solo el dueño puede sacar cosas de una cuenta.');
  return db.transaction((tx) => {
    const cuenta = cuentaParaCambiar(tx, pedidoId);
    const item = tx.select().from(pedidoItems).where(and(eq(pedidoItems.id, datos.itemId), eq(pedidoItems.pedidoId, pedidoId))).get();
    if (!item) throw new ErrorDeUsuario('Ese renglón ya no está en la cuenta.');
    if (datos.cantidad > item.cantidad) throw new ErrorDeUsuario(`En la cuenta hay ${item.cantidad}: no se pueden sacar ${datos.cantidad}.`);

    const montoCentavos = Math.round((item.totalCentavos * datos.cantidad) / item.cantidad);
    tx.insert(itemsQuitados)
      .values({
        pedidoId,
        productoId: item.productoId,
        nombre: item.varianteNombre ? `${item.nombre} ${item.varianteNombre}` : item.nombre,
        cantidad: datos.cantidad,
        montoCentavos,
        ronda: item.ronda,
        sector: item.sector,
        motivo: datos.motivo,
        usuarioId: usuario.id,
        creadoEn: momentoLocal(ahora),
      })
      .run();

    if (datos.cantidad === item.cantidad) {
      tx.delete(pedidoItemAgregados).where(eq(pedidoItemAgregados.itemId, item.id)).run();
      tx.delete(pedidoItems).where(eq(pedidoItems.id, item.id)).run();
    } else {
      tx.update(pedidoItems)
        .set({ cantidad: item.cantidad - datos.cantidad, totalCentavos: item.totalCentavos - montoCentavos })
        .where(eq(pedidoItems.id, item.id))
        .run();
    }

    // Si ya nada de esa ronda espera en ese sector, la comanda sobra (salvo que ya se haya preparado).
    if (item.vaACocina) {
      const quedan = tx
        .select({ n: sql<number>`count(*)` })
        .from(pedidoItems)
        .where(
          and(
            eq(pedidoItems.pedidoId, pedidoId),
            eq(pedidoItems.ronda, item.ronda),
            eq(pedidoItems.vaACocina, true),
            sql`coalesce(${pedidoItems.sector}, 'cocina') = ${item.sector ?? 'cocina'}`,
          ),
        )
        .get();
      if (Number(quedan?.n ?? 0) === 0) {
        tx.delete(comandas)
          .where(
            and(
              eq(comandas.pedidoId, pedidoId),
              eq(comandas.ronda, item.ronda),
              eq(comandas.sector, item.sector ?? 'cocina'),
              sql`${comandas.estado} IN ('pendiente', 'preparando')`,
            ),
          )
          .run();
      }
    }

    const subtotal = Number(
      tx.select({ s: sql<number>`coalesce(sum(${pedidoItems.totalCentavos}), 0)` }).from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)).get()?.s ?? 0,
    );
    const totalCentavos = subtotal + cuenta.envioCentavos;
    tx.update(pedidos)
      .set({
        subtotalCentavos: subtotal,
        totalCentavos,
        propinaCentavos: 0, // cambió el consumo: la propina se vuelve a poner al cobrar
        cuentaPedidaEn: subtotal === 0 ? null : cuenta.cuentaPedidaEn,
        actualizadoEn: ahoraSql,
      })
      .where(eq(pedidos.id, pedidoId))
      .run();
    return { montoCentavos, totalCentavos };
  });
}

// ───────────────────────── Pasar y juntar mesas ─────────────────────────

/** La gente se cambió de mesa: la cuenta sigue igual, en otra mesa que esté libre. */
export function pasarMesa(db: BaseDeDatos, pedidoId: number, mesaDestinoId: number): void {
  db.transaction((tx) => {
    const cuenta = cuentaParaCambiar(tx, pedidoId);
    const destino = mesaActiva(tx, mesaDestinoId);
    if (cuenta.mesaId === destino.id) throw new ErrorDeUsuario(`Ya están en la mesa ${destino.nombre}.`);
    if (cuentaAbiertaDe(tx, destino.id)) {
      throw new ErrorDeUsuario(`La mesa ${destino.nombre} está ocupada. Si se juntan con esa mesa, usá "Juntar con otra mesa".`);
    }
    try {
      tx.update(pedidos).set({ mesaId: destino.id, mesa: destino.nombre, actualizadoEn: ahoraSql }).where(eq(pedidos.id, pedidoId)).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new ErrorDeUsuario(`La mesa ${destino.nombre} se acaba de ocupar.`);
      throw error;
    }
  });
}

/**
 * Dos mesas que se juntan pagan juntas: lo de la cuenta `origen` pasa a la
 * cuenta `destino` (con sus rondas renumeradas a continuación, y sus comandas
 * con ellas) y la cuenta origen se anula "sin consumo": la mesa queda libre.
 */
export function juntarMesas(db: BaseDeDatos, origenId: number, destinoId: number, usuario: Usuario | null, ahora: Date = new Date()): void {
  if (origenId === destinoId) throw new ErrorDeUsuario('Elegí otra mesa para juntar.');
  db.transaction((tx) => {
    const origen = cuentaParaCambiar(tx, origenId);
    const destino = cuentaParaCambiar(tx, destinoId);

    const desplazaRonda = tx.select({ n: max(rondas.numero) }).from(rondas).where(eq(rondas.pedidoId, destinoId)).get()?.n ?? 0;
    const desplazaOrden = (tx.select({ n: max(pedidoItems.orden) }).from(pedidoItems).where(eq(pedidoItems.pedidoId, destinoId)).get()?.n ?? -1) + 1;

    // Las rondas, los renglones y las comandas de la cuenta que se une pasan a la otra.
    tx.update(rondas).set({ pedidoId: destinoId, numero: sql`${rondas.numero} + ${desplazaRonda}` }).where(eq(rondas.pedidoId, origenId)).run();
    tx.update(pedidoItems)
      .set({ pedidoId: destinoId, ronda: sql`${pedidoItems.ronda} + ${desplazaRonda}`, orden: sql`${pedidoItems.orden} + ${desplazaOrden}` })
      .where(eq(pedidoItems.pedidoId, origenId))
      .run();
    tx.update(comandas).set({ pedidoId: destinoId, ronda: sql`${comandas.ronda} + ${desplazaRonda}` }).where(eq(comandas.pedidoId, origenId)).run();
    tx.update(itemsQuitados).set({ pedidoId: destinoId, ronda: sql`${itemsQuitados.ronda} + ${desplazaRonda}` }).where(eq(itemsQuitados.pedidoId, origenId)).run();

    const subtotalCentavos = destino.subtotalCentavos + origen.subtotalCentavos;
    const personas = (destino.comensales ?? 0) + (origen.comensales ?? 0);
    tx.update(pedidos)
      .set({
        subtotalCentavos,
        totalCentavos: subtotalCentavos + destino.envioCentavos,
        propinaCentavos: 0,
        comensales: personas > 0 ? Math.min(99, personas) : null,
        cuentaPedidaEn: null,
        // Si cualquiera de las dos tenía comida pendiente, la cuenta unida vuelve a "pendiente".
        ...(origen.estado === 'pendiente' || destino.estado === 'pendiente' ? { estado: 'pendiente' as const } : {}),
        actualizadoEn: ahoraSql,
      })
      .where(eq(pedidos.id, destinoId))
      .run();

    tx.update(pedidos)
      .set({
        estado: 'anulado',
        motivoAnulacion: `Juntada con la mesa ${destino.mesa} (cuenta #${destino.numero})`,
        subtotalCentavos: 0,
        totalCentavos: 0,
        propinaCentavos: 0,
        anuladoEn: momentoLocal(ahora),
        anuladoPor: usuario?.id ?? null,
        actualizadoEn: ahoraSql,
      })
      .where(eq(pedidos.id, origenId))
      .run();
  });
}
