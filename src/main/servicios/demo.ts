// Datos de demostración: 45 días de ventas "creíbles" para mostrarle el
// sistema a un cliente con los gráficos llenos (Reportes vacíos no venden).
//
// - Solo se puede cargar en una caja SIN pedidos (no mezcla con ventas reales).
// - Usa las mismas funciones que la caja de verdad (crearPedido, abrirCaja,
//   cerrarCaja…), así los datos respetan todas las reglas.
// - El "azar" es fijo (misma semilla): siempre sale la misma demo.
import { and, eq, sql } from 'drizzle-orm';
import type { BaseDeDatos } from '../db/conexion';
import { mesas, pedidos, usuarios } from '../db/esquema';
import { esquemaAbrirMesa, esquemaPagos, esquemaPedido, esquemaQuitarItem, esquemaRonda } from '@compartido/esquemas';
import { armarLinea } from '@compartido/precios';
import type { MedioDePago, Menu, TipoPedido, Usuario } from '@compartido/tipos';
import { abrirCaja, cajaAbierta, cerrarCaja, resumenDeCaja } from './caja';
import { ErrorDeUsuario } from './errores';
import { fechaLocal, momentoLocal } from './fechas';
import { obtenerMenu } from './menu';
import { cargarMenuDeEjemplo } from './menu-ejemplo';
import { anularPedido, cobrarPedido, crearPedido, obtenerPedido } from './pedidos';
import { abrirMesa, agregarRonda, cargarSalonEjemplo } from './salon';
import { fijarPropina, quitarItem } from './cuenta';
import { cambiarEstadoComanda, comandasDe } from './comandas';
import { guardarUsuario } from './usuarios';

export const DIAS_DEMO = 45;
/** Los últimos días traen cuentas de salón (mozos, comandas con tiempos, propinas). */
const DIAS_DE_SALON = 21;
export const CAJERA_DEMO = { nombre: 'Marta', pin: '1111' };

const CLIENTES = [
  ['370 455-6677', 'Lucía Benítez', 'Belgrano 845'],
  ['370 411-2233', 'María Gómez', 'España 120'],
  ['370 498-1100', 'Jorge Acosta', 'Av. 25 de Mayo 1430'],
  ['370 422-9876', 'Carla Ríos', 'Saavedra 550'],
  ['370 433-4455', 'Diego Ojeda', 'Fontana 77'],
  ['370 466-1212', 'Paula Sosa', 'Rivadavia 2010'],
  ['370 477-3030', 'Martín López', 'Moreno 315'],
  ['370 488-5656', 'Sofía Duarte', 'Brandsen 640'],
] as const;

/** Generador de números "al azar" con semilla (Park-Miller): repetible. */
function azarConSemilla(semilla: number) {
  let s = semilla;
  const azar = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const uno = <T>(lista: readonly T[]): T => lista[Math.floor(azar() * lista.length)]!;
  const pesado = <T>(pares: [T, number][]): T => {
    let r = azar() * pares.reduce((t, [, p]) => t + p, 0);
    for (const [valor, peso] of pares) if ((r -= peso) < 0) return valor;
    return pares[0]![0];
  };
  return { azar, uno, pesado };
}

export interface ResultadoDemo {
  pedidos: number;
  dias: number;
  clientes: number;
}

export function hayPedidos(db: BaseDeDatos): boolean {
  return (db.select({ n: sql<number>`count(*)` }).from(pedidos).get()?.n ?? 0) > 0;
}

export function cargarDemo(db: BaseDeDatos, dueno: Usuario, ahora: Date = new Date()): ResultadoDemo {
  if (hayPedidos(db)) {
    throw new ErrorDeUsuario('La demo solo se puede cargar en una caja sin pedidos (para no mezclarla con ventas reales).');
  }
  if (cajaAbierta(db)) throw new ErrorDeUsuario('Cerrá la caja antes de cargar la demo.');

  let total = 0;
  // Todo en una transacción: si algo falla, no queda una demo a medias.
  db.$client.transaction(() => {
    // Si el menú está vacío, usamos el de ejemplo; si ya hay uno, la demo vende ESE menú.
    if (!obtenerMenu(db).productos.length) cargarMenuDeEjemplo(db);
    const menu: Menu = obtenerMenu(db);

    // Una cajera de ejemplo, para que se vea "Ventas por usuario"
    const existente = db.select().from(usuarios).where(eq(usuarios.nombre, CAJERA_DEMO.nombre)).get();
    const cajera: Usuario = existente
      ? { id: existente.id, nombre: existente.nombre, rol: existente.rol }
      : { id: guardarUsuario(db, { nombre: CAJERA_DEMO.nombre, rol: 'cajero', pin: CAJERA_DEMO.pin }), nombre: CAJERA_DEMO.nombre, rol: 'cajero' };

    const { azar, uno, pesado } = azarConSemilla(20261110);
    const disponibles = menu.productos.filter((p) => p.disponible);
    if (!disponibles.length) throw new ErrorDeUsuario('Para la demo hace falta al menos un producto disponible en el menú.');
    // Lo clásico se vende más
    const pesos: [(typeof disponibles)[number], number][] = disponibles.map((p) => [
      p,
      /Clásica|Muzzarella|Empanada de carne|Lomito|Gaseosa|Milanesa/.test(p.nombre) ? 5 : /Cerveza|Papas|Doble|Café|Medialuna/.test(p.nombre) ? 3 : 1,
    ]);
    const seleccion = (p: (typeof disponibles)[number]) => {
      const grupos = p.gruposIds.map((id) => menu.grupos.find((g) => g.id === id)).filter((g) => g !== undefined);
      return {
        productoId: p.id,
        varianteId: p.variantes.length ? uno(p.variantes).id : null,
        opcionesIds: grupos.flatMap((g) => g.opciones.slice(0, g.minimo).map((o) => o.id)),
        cantidad: 1 + Math.floor(azar() * 2),
        nota: '',
      };
    };

    // Salón: mesas y mozos (si no hay, los de ejemplo) para las cuentas de los últimos días.
    if (!db.select({ id: mesas.id }).from(mesas).where(eq(mesas.activa, true)).get()) cargarSalonEjemplo(db, dueno, ahora);
    // El salón de ejemplo deja algunas mesas con cuenta abierta (para que se vea "vivo"): esas no se tocan.
    const ocupadas = new Set(
      (db.$client.prepare(`SELECT mesa_id AS id FROM pedidos WHERE mesa_id IS NOT NULL AND cobrado = 0 AND estado <> 'anulado'`).all() as { id: number }[]).map((r) => r.id),
    );
    const mesasDelSalon = db
      .select({ id: mesas.id })
      .from(mesas)
      .where(eq(mesas.activa, true))
      .all()
      .map((m) => m.id)
      .filter((id) => !ocupadas.has(id));
    const mozos: Usuario[] = db
      .select({ id: usuarios.id, nombre: usuarios.nombre, rol: usuarios.rol })
      .from(usuarios)
      .where(and(eq(usuarios.activo, true), eq(usuarios.rol, 'mozo')))
      .all();

    const hoy = fechaLocal(ahora);
    for (let atras = DIAS_DEMO - 1; atras >= 0; atras--) {
      const dia = new Date(ahora);
      dia.setDate(dia.getDate() - atras);
      dia.setHours(11, 0, 0, 0);
      const esHoy = fechaLocal(dia) === hoy;
      const quien = (h: Date) => (h.getDay() % 2 === 0 ? dueno : cajera);

      // Si la demo se carga temprano (antes de las 11), la caja de hoy se abre "recién".
      const apertura = esHoy && ahora < dia ? new Date(ahora.getTime() - 60_000) : dia;
      abrirCaja(db, 2_000_000, quien(dia), apertura); // fondo $20.000
      const finde = [0, 5, 6].includes(dia.getDay());
      const cantidad = Math.round((finde ? 26 : 15) * (0.75 + azar() * 0.5));
      const horas = Array.from({ length: cantidad }, () =>
        pesado<number>([[11, 1], [12, 4], [13, 5], [14, 2], [19, 1], [20, 4], [21, 7], [22, 5], [23, 2]]),
      ).sort((a, b) => a - b);

      for (const hora of horas) {
        const momento = new Date(dia);
        momento.setHours(hora, Math.floor(azar() * 60), 0, 0);
        if (esHoy && momento > ahora) break; // hoy: solo hasta la hora actual
        const tipo = pesado<TipoPedido>([['mostrador', 4], ['llevar', 2], ['delivery', 3], ['mesa', 3]]);
        const items = Array.from({ length: 1 + Math.floor(azar() * 3) }, () => seleccion(pesado(pesos)));
        const lineas = items.map((s) => armarLinea(menu, s));
        if (lineas.some((l) => !l.ok)) continue;
        const envio = tipo === 'delivery' ? 150_000 : 0;
        const totalPedido = lineas.reduce((s, l) => s + (l.ok ? l.valor.totalCentavos : 0), 0) + envio;
        const cliente = tipo === 'delivery' ? uno(CLIENTES) : null;
        const medio = pesado<MedioDePago>([['efectivo', 5], ['transferencia', 3], ['debito', 2], ['qr', 2], ['credito', 1]]);
        // Efectivo: a veces pagan con un billete más grande (para que haya vuelto)
        const recibido = medio === 'efectivo' ? Math.ceil(totalPedido / 1_000_000) * 1_000_000 : undefined;
        const datos = esquemaPedido.parse({
          tipo,
          mesa: tipo === 'mesa' ? String(1 + Math.floor(azar() * 12)) : '',
          clienteNombre: cliente?.[1] ?? '',
          clienteTelefono: cliente?.[0] ?? '',
          clienteDireccion: cliente?.[2] ?? '',
          envioCentavos: envio,
          items,
          pagos: [{ medio, montoCentavos: totalPedido, ...(recibido ? { recibidoCentavos: recibido } : {}) }],
          totalEsperadoCentavos: totalPedido,
        });
        const creado = crearPedido(db, datos, momento, quien(momento).id);
        total++;
        if (azar() < 0.025) anularPedido(db, creado.id, 'El cliente se arrepintió', dueno.id);
      }

      if (atras < DIAS_DE_SALON && mozos.length && mesasDelSalon.length) {
        const cuentas = Math.round((finde ? 9 : 5) * (0.75 + azar() * 0.5));
        for (let c = 0; c < cuentas; c++) {
          const hora = pesado<number>([[12, 4], [13, 5], [14, 2], [20, 4], [21, 7], [22, 4]]);
          const abierta = new Date(dia);
          abierta.setHours(hora, Math.floor(azar() * 45), 0, 0);
          if (esHoy && abierta.getTime() + 75 * 60_000 > ahora.getTime()) continue; // hoy: solo cuentas ya cobradas
          const mozo = uno(mozos);
          const mesaId = uno(mesasDelSalon);
          const minutos = (n: number) => new Date(abierta.getTime() + n * 60_000);
          // Primero se arma lo que van a pedir (si algo no se puede vender, se salta la cuenta
          // ANTES de abrir la mesa: así nunca queda una mesa ocupada de más).
          const plan: { items: ReturnType<typeof seleccion>[]; total: number }[] = [];
          for (let r = 0, cuantas = azar() < 0.4 ? 2 : 1; r < cuantas; r++) {
            const items = Array.from({ length: 1 + Math.floor(azar() * 3) }, () => seleccion(pesado(pesos)));
            const lineas = items.map((i) => armarLinea(menu, i));
            if (lineas.every((l) => l.ok)) plan.push({ items, total: lineas.reduce((s, l) => s + (l.ok ? l.valor.totalCentavos : 0), 0) });
          }
          if (plan.length === 0) continue;
          try {
            const pedidoId = abrirMesa(db, esquemaAbrirMesa.parse({ mesaId, comensales: 2 + Math.floor(azar() * 4), mozoId: mozo.id }), mozo, abierta);
            plan.forEach((ronda, r) => {
              const t0 = r * 28;
              agregarRonda(db, pedidoId, esquemaRonda.parse({ items: ronda.items, totalEsperadoCentavos: ronda.total }), mozo, minutos(t0));
              // La cocina y la barra: la mayoría sale en tiempo; algunas se demoran.
              for (const comanda of comandasDe(db, [pedidoId]).filter((x) => x.ronda === r + 1)) {
                const tarde = azar() < 0.12;
                const empieza = t0 + 1 + Math.floor(azar() * (tarde ? 12 : 5));
                const lista = empieza + (comanda.sector === 'barra' ? 2 + Math.floor(azar() * 4) : (tarde ? 18 : 7) + Math.floor(azar() * 10));
                cambiarEstadoComanda(db, comanda.id, 'preparando', minutos(empieza));
                cambiarEstadoComanda(db, comanda.id, 'lista', minutos(lista));
                cambiarEstadoComanda(db, comanda.id, 'entregada', minutos(lista + 1 + Math.floor(azar() * 3)));
              }
            });
            const cuenta = obtenerPedido(db, pedidoId);
            // De vez en cuando el dueño saca algo (se anota quién y por qué).
            if (azar() < 0.05 && cuenta.items.length > 1) {
              quitarItem(db, pedidoId, esquemaQuitarItem.parse({ itemId: cuenta.items[0]!.id, cantidad: 1, motivo: pesado(['Salió frío', 'Error al cargar'].map((m) => [m, 1] as [string, number])) }), dueno, minutos(60));
            }
            const consumo = obtenerPedido(db, pedidoId).subtotalCentavos;
            if (azar() < 0.55) fijarPropina(db, pedidoId, Math.round((consumo * pesado<number>([[0.1, 6], [0.15, 2], [0.2, 1]])) / 100) * 100);
            const aCobrar = obtenerPedido(db, pedidoId).totalCentavos;
            const medio = pesado<MedioDePago>([['efectivo', 4], ['transferencia', 3], ['debito', 3], ['qr', 2], ['credito', 1]]);
            cobrarPedido(db, pedidoId, esquemaPagos.parse([{ medio, montoCentavos: aCobrar }]), quien(minutos(75)).id);
            // El cobro se anota con la hora real de "ahora": lo llevamos al momento de la cuenta.
            db.$client.prepare('UPDATE pagos SET creado_en = ? WHERE pedido_id = ?').run(momentoLocal(minutos(75)), pedidoId);
            total++;
          } catch {
            // Si una cuenta de ejemplo no se puede armar (mesa ocupada, etc.), seguimos con la siguiente.
          }
        }
      }

      if (!esHoy) {
        // Cerrar el día: casi siempre cuadra; a veces faltan o sobran monedas.
        const cajaDelDia = cajaAbierta(db)!;
        const esperado = resumenDeCaja(db, cajaDelDia.id).efectivoEsperadoCentavos;
        const diferencia = pesado<number>([[0, 8], [-50_000, 1], [20_000, 1]]);
        const cierre = new Date(dia);
        cierre.setHours(23, 50, 0, 0);
        cerrarCaja(db, { contadoCentavos: esperado + diferencia, nota: '' }, quien(dia), cierre);
      }
    }

    // Los pedidos de días anteriores ya se entregaron; los de hoy quedan en
    // distintos estados para que el tablero de Pedidos se vea "vivo".
    db.$client.prepare(`UPDATE pedidos SET estado = 'entregado' WHERE estado <> 'anulado' AND fecha < ?`).run(hoy);
    const deHoy = db.$client
      .prepare(`SELECT id FROM pedidos WHERE fecha = ? AND estado <> 'anulado' AND mesa_id IS NULL ORDER BY hora DESC`)
      .all(hoy) as { id: number }[];
    const estados = ['pendiente', 'en_preparacion', 'en_preparacion', 'listo'];
    const actualizar = db.$client.prepare(`UPDATE pedidos SET estado = ? WHERE id = ?`);
    deHoy.forEach((p, i) => actualizar.run(estados[i] ?? 'entregado', p.id));
  })();

  return {
    pedidos: total,
    dias: DIAS_DEMO,
    clientes: CLIENTES.length,
  };
}
