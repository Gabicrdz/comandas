// Reportes del salón: cómo le fue a cada mozo y cuánto tarda la cocina y la
// barra. Igual que el resto de los reportes, es SQL "de toda la vida" que se
// puede probar en DB Browser cambiando los ? por fechas entre comillas.
import type { z } from 'zod';
import type { BaseDeDatos } from '../db/conexion';
import type { esquemaRango } from '@compartido/esquemas';
import { LIMITE_TARDE_MIN, SECTORES, type ReporteSalon, type Sector } from '@compartido/tipos';

type Consultable = Pick<BaseDeDatos, '$client'>;
type Rango = z.output<typeof esquemaRango>;

const aPesosEnteros = (centavos: number) => Math.round(centavos / 100) * 100;
const segundos = (n: number | null) => (n === null ? null : Math.round(n));

export function obtenerReporteSalon(db: Consultable, { desde, hasta }: Rango): ReporteSalon {
  const c = db.$client;
  const filas = <T>(consulta: string, ...params: unknown[]) => c.prepare(consulta).all(...params) as T[];

  // 1) Mozos: solo cuentas de mesa ya cobradas (una cuenta abierta todavía no es una venta).
  const mozos = filas<{ mozoId: number | null; nombre: string; cuentas: number; comensales: number; ventas: number; propinas: number }>(
    `SELECT p.mozo_id AS mozoId, coalesce(u.nombre, 'Sin mozo') AS nombre, count(*) AS cuentas,
            coalesce(sum(p.comensales), 0) AS comensales,
            coalesce(sum(p.total_centavos - p.propina_centavos), 0) AS ventas,
            coalesce(sum(p.propina_centavos), 0) AS propinas
     FROM pedidos p LEFT JOIN usuarios u ON u.id = p.mozo_id
     WHERE p.mesa_id IS NOT NULL AND p.cobrado = 1 AND p.estado <> 'anulado' AND p.fecha BETWEEN ? AND ?
     GROUP BY p.mozo_id ORDER BY ventas DESC, nombre`,
    desde,
    hasta,
  ).map((f) => ({
    mozoId: f.mozoId,
    nombre: f.nombre,
    cuentas: f.cuentas,
    comensales: f.comensales,
    ventasCentavos: f.ventas,
    propinasCentavos: f.propinas,
    ticketPromedioCentavos: f.cuentas ? aPesosEnteros(f.ventas / f.cuentas) : 0,
    porPersonaCentavos: f.comensales ? aPesosEnteros(f.ventas / f.comensales) : 0,
  }));

  // 2) Cocina y barra: promedios en segundos entre los momentos que anota cada comanda.
  //    avg() ignora los NULL, así que una comanda sin "lista_en" no ensucia el promedio.
  const tiempos = new Map(
    filas<{ sector: Sector; comandas: number; espera: number | null; preparacion: number | null; total: number | null; entrega: number | null; tardias: number }>(
      `SELECT k.sector, count(*) AS comandas,
              avg(strftime('%s', k.empezada_en) - strftime('%s', k.creada_en)) AS espera,
              avg(strftime('%s', k.lista_en) - strftime('%s', k.empezada_en)) AS preparacion,
              avg(strftime('%s', k.lista_en) - strftime('%s', k.creada_en)) AS total,
              avg(strftime('%s', k.entregada_en) - strftime('%s', k.lista_en)) AS entrega,
              coalesce(sum(CASE WHEN k.lista_en IS NOT NULL AND strftime('%s', k.lista_en) - strftime('%s', k.creada_en) > ? * 60 THEN 1 ELSE 0 END), 0) AS tardias
       FROM comandas k JOIN pedidos p ON p.id = k.pedido_id
       WHERE p.estado <> 'anulado' AND substr(k.creada_en, 1, 10) BETWEEN ? AND ?
       GROUP BY k.sector`,
      LIMITE_TARDE_MIN,
      desde,
      hasta,
    ).map((f) => [f.sector, f]),
  );
  const cocina = SECTORES.map((sector) => {
    const t = tiempos.get(sector);
    return {
      sector,
      comandas: t?.comandas ?? 0,
      esperaSeg: segundos(t?.espera ?? null),
      preparacionSeg: segundos(t?.preparacion ?? null),
      totalSeg: segundos(t?.total ?? null),
      entregaSeg: segundos(t?.entrega ?? null),
      tardias: t?.tardias ?? 0,
    };
  });

  // 3) Lo que el dueño sacó de las cuentas (no importa si la cuenta se cobró o sigue abierta).
  const totalQuitado = c
    .prepare(`SELECT coalesce(sum(cantidad), 0) AS unidades, coalesce(sum(monto_centavos), 0) AS monto FROM items_quitados WHERE substr(creado_en, 1, 10) BETWEEN ? AND ?`)
    .get(desde, hasta) as { unidades: number; monto: number };
  const lista = filas<{
    id: number;
    nombre: string;
    cantidad: number;
    montoCentavos: number;
    ronda: number;
    motivo: string;
    usuario: string | null;
    creadoEn: string;
    mesa: string;
    numero: number;
  }>(
    `SELECT q.id, q.nombre, q.cantidad, q.monto_centavos AS montoCentavos, q.ronda, q.motivo, u.nombre AS usuario, q.creado_en AS creadoEn,
            p.mesa, p.numero
     FROM items_quitados q
     JOIN pedidos p ON p.id = q.pedido_id
     LEFT JOIN usuarios u ON u.id = q.usuario_id
     WHERE substr(q.creado_en, 1, 10) BETWEEN ? AND ?
     ORDER BY q.id DESC LIMIT 100`,
    desde,
    hasta,
  );

  return { desde, hasta, mozos, cocina, quitados: { unidades: totalQuitado.unidades, montoCentavos: totalQuitado.monto, lista } };
}
