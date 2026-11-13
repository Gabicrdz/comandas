import { beforeEach, describe, expect, it } from 'vitest';
import type { BaseDeDatos } from '../src/main/db/conexion';
import { esquemaAbrirMesa, esquemaMesa, esquemaPagos, esquemaQuitarItem, esquemaRango, esquemaRonda } from '../src/compartido/esquemas';
import { asignadasDeMas, dividirIgual, dividirPorItem, repartirIgual, repartirProporcional } from '../src/compartido/division';
import type { Menu, Usuario } from '../src/compartido/tipos';
import * as menu from '../src/main/servicios/menu';
import { cargarMenuDeEjemplo } from '../src/main/servicios/menu-ejemplo';
import { cobrarPedido, obtenerPedido, resumenDelDia } from '../src/main/servicios/pedidos';
import * as salon from '../src/main/servicios/salon';
import * as cuentaDeMesa from '../src/main/servicios/cuenta';
import { cambiarEstadoComanda, listarComandas } from '../src/main/servicios/comandas';
import { obtenerReporte } from '../src/main/servicios/reportes';
import { obtenerReporteSalon } from '../src/main/servicios/reporte-salon';
import { guardarUsuario } from '../src/main/servicios/usuarios';
import { htmlDivision, htmlTicket } from '../src/main/impresion/plantillas';
import { $, baseNueva, dueñoConCaja } from './ayudantes';

let db: BaseDeDatos;
let m: Menu;
let yo: Usuario;
let zona: number;
const sabado = new Date(2026, 10, 14, 21, 0);
const minutos = (n: number) => new Date(sabado.getTime() + n * 60_000);

beforeEach(() => {
  db = baseNueva();
  cargarMenuDeEjemplo(db);
  m = menu.obtenerMenu(db);
  yo = dueñoConCaja(db);
  zona = salon.obtenerSalon(db).zonas[0]!.id;
});

const producto = (nombre: string) => m.productos.find((p) => p.nombre === nombre)!;
const item = (nombre: string, cantidad = 1) => ({ productoId: producto(nombre).id, varianteId: null, opcionesIds: [], cantidad, nota: '' });
const mesa = (nombre: string) => salon.guardarMesa(db, esquemaMesa.parse({ zonaId: zona, nombre, lugares: 4, forma: 'cuadrada' }));
const sentar = (mesaId: number, comensales = 2, mozoId: number | null = null, cuando = sabado) =>
  salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId, comensales, mozoId }), yo, cuando);
const ronda = (pedidoId: number, items: ReturnType<typeof item>[], total: number, cuando = sabado) =>
  salon.agregarRonda(db, pedidoId, esquemaRonda.parse({ items, totalEsperadoCentavos: total }), yo, cuando);
const estadoDe = (mesaId: number) => salon.obtenerSalon(db).mesas.find((x) => x.id === mesaId)!;
const cajero = (): Usuario => ({ id: guardarUsuario(db, { nombre: 'Caro', rol: 'cajero', pin: '4444' }), nombre: 'Caro', rol: 'cajero' });
const rango = (desde: string, hasta: string) => esquemaRango.parse({ desde, hasta });
const quitar = (pedidoId: number, itemId: number, cantidad: number, motivo = 'Salió frío', quien = yo) =>
  cuentaDeMesa.quitarItem(db, pedidoId, esquemaQuitarItem.parse({ itemId, cantidad, motivo }), quien, sabado);

describe('dividir la cuenta (funciones puras)', () => {
  it('reparte siempre exacto y en pesos enteros: lo que sobra va de a un peso a los primeros', () => {
    expect(repartirIgual($(10000), 3)).toEqual([$(3334), $(3333), $(3333)]);
    expect(repartirIgual(1001, 3)).toEqual([334, 334, 333]); // un monto con centavos se reparte en centavos
    expect(repartirIgual($(9000), 3)).toEqual([$(3000), $(3000), $(3000)]);
    for (const [monto, partes] of [[1, 3], [100, 7], [$(35800), 6], [0, 4]] as const) {
      expect(repartirIgual(monto, partes).reduce((s, x) => s + x, 0)).toBe(monto);
    }
    expect(() => repartirIgual(100, 0)).toThrow('al menos una persona');
  });

  it('partes iguales: consumo y propina por separado', () => {
    const partes = dividirIgual($(30000), $(3000), 3);
    expect(partes.map((p) => p.totalCentavos)).toEqual([$(11000), $(11000), $(11000)]);
    expect(partes.reduce((s, p) => s + p.totalCentavos, 0)).toBe($(33000));
    expect(partes[0]).toMatchObject({ persona: 1, consumoCentavos: $(10000), propinaCentavos: $(1000) });
    // $ 35.700 + $ 3.570 entre 4: nadie paga centavos y suma exacto.
    const cuatro = dividirIgual($(35700), $(3570), 4);
    expect(cuatro.map((p) => p.totalCentavos)).toEqual([$(9818), $(9818), $(9817), $(9817)]);
    expect(cuatro.reduce((s, p) => s + p.totalCentavos, 0)).toBe($(39270));
  });

  it('la propina se reparte en proporción a lo consumido y siempre suma exacto', () => {
    expect(repartirProporcional($(1000), [3000, 1000])).toEqual([$(750), $(250)]);
    expect(repartirProporcional($(1000), [1, 1, 1])).toEqual([$(334), $(333), $(333)]);
    expect(repartirProporcional(101, [1, 1, 1]).reduce((s, x) => s + x, 0)).toBe(101);
    expect(repartirProporcional($(100), [0, 0])).toEqual([$(50), $(50)]); // nadie consumió: iguales
  });

  it('por ítem: cada uno paga lo suyo y avisa lo que falta asignar', () => {
    // 2 hamburguesas de $ 8.500 (total $ 17.000) y 1 postre de $ 4.200.
    const renglones = [
      { id: 10, cantidad: 2, totalCentavos: $(17000) },
      { id: 11, cantidad: 1, totalCentavos: $(4200) },
    ];
    const a = dividirPorItem(renglones, { 10: [1, 1], 11: [1, 0] }, 2, $(2120));
    expect(a.sinAsignar).toEqual([]);
    expect(a.partes.map((p) => p.consumoCentavos)).toEqual([$(12700), $(8500)]);
    expect(a.partes.reduce((s, p) => s + p.totalCentavos, 0)).toBe($(21200) + $(2120));

    const faltan = dividirPorItem(renglones, { 10: [1, 0] }, 2, 0);
    expect(faltan.sinAsignar).toEqual([
      { id: 10, unidades: 1 },
      { id: 11, unidades: 1 },
    ]);
    expect(asignadasDeMas(renglones, { 10: [2, 1] })).toEqual([10]);
  });
});

describe('propina', () => {
  it('forma parte de lo que se cobra, pero no de las ventas', () => {
    const lucas = guardarUsuario(db, { nombre: 'Lucas', rol: 'mozo', pin: '2222' });
    const cuenta = sentar(mesa('1'), 2, lucas);
    expect(() => cuentaDeMesa.fijarPropina(db, cuenta, $(500))).toThrow('todavía no pidió nada');
    ronda(cuenta, [item('Sándwich de milanesa', 2)], $(23000), minutos(5));

    expect(() => cuentaDeMesa.fijarPropina(db, cuenta, $(23001))).toThrow('no puede ser más que el consumo');
    expect(cuentaDeMesa.fijarPropina(db, cuenta, $(2500))).toBe($(25500));
    let p = obtenerPedido(db, cuenta);
    expect(p).toMatchObject({ subtotalCentavos: $(23000), propinaCentavos: $(2500), totalCentavos: $(25500) });
    expect(estadoDe(salon.obtenerSalon(db).mesas[0]!.id).cuenta?.totalCentavos).toBe($(25500));

    // El ticket muestra el consumo y la propina.
    const ticket = htmlTicket(p, 'Bar', 80).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(ticket).toContain('Propina');
    expect(ticket).toContain('$ 2.500');

    // Hay que pagar el total CON propina.
    expect(() => cobrarPedido(db, cuenta, esquemaPagos.parse([{ medio: 'efectivo', montoCentavos: $(23000) }]), yo.id)).toThrow('Los pagos suman');
    cobrarPedido(db, cuenta, esquemaPagos.parse([{ medio: 'efectivo', montoCentavos: $(25500) }]), yo.id);
    p = obtenerPedido(db, cuenta);
    expect(p.cobrado).toBe(true);

    // Reportes: ventas $ 23.000; propinas $ 2.500 aparte; el medio de pago sí incluye lo que entró.
    const r = obtenerReporte(db, rango('2026-11-14', '2026-11-14'));
    expect(r.ventasCentavos).toBe($(23000));
    expect(r.propinasCentavos).toBe($(2500));
    expect(r.porMedio.find((x) => x.medio === 'efectivo')?.montoCentavos).toBe($(25500));
    expect(resumenDelDia(db, sabado).totalCentavos).toBe($(23000));
  });

  it('si piden algo más, la propina se borra (se vuelve a poner al cobrar)', () => {
    const cuenta = sentar(mesa('1'));
    ronda(cuenta, [item('Sándwich de milanesa')], $(11500));
    cuentaDeMesa.fijarPropina(db, cuenta, $(1150));
    ronda(cuenta, [item('Flan casero')], $(4200), minutos(10));
    expect(obtenerPedido(db, cuenta)).toMatchObject({ propinaCentavos: 0, totalCentavos: $(15700) });
    cuentaDeMesa.fijarPropina(db, cuenta, $(1000));
    expect(cuentaDeMesa.fijarPropina(db, cuenta, 0)).toBe($(15700));
  });
});

describe('sacar algo de la cuenta', () => {
  it('solo el dueño, con motivo: queda anotado y la cuenta se corrige', () => {
    const cuenta = sentar(mesa('1'));
    ronda(cuenta, [item('Sándwich de milanesa', 3), item('Cerveza lata 473 ml', 2)], $(40900));
    const [milas, cervezas] = obtenerPedido(db, cuenta).items;

    expect(() => quitar(cuenta, milas!.id, 1, 'Salió frío', cajero())).toThrow('Solo el dueño');
    expect(() => esquemaQuitarItem.parse({ itemId: milas!.id, cantidad: 1, motivo: 'x' })).toThrow('motivo');
    expect(() => quitar(cuenta, milas!.id, 4)).toThrow('hay 3');

    // Una de las tres milanesas.
    expect(quitar(cuenta, milas!.id, 1)).toEqual({ montoCentavos: $(11500), totalCentavos: $(29400) });
    let p = obtenerPedido(db, cuenta);
    expect(p.items.find((i) => i.id === milas!.id)).toMatchObject({ cantidad: 2, totalCentavos: $(23000) });
    expect(p.totalCentavos).toBe($(29400));
    expect(p.quitados).toMatchObject([{ nombre: 'Sándwich de milanesa', cantidad: 1, montoCentavos: $(11500), motivo: 'Salió frío', usuario: 'Sergio' }]);

    // Las dos cervezas: el renglón desaparece.
    quitar(cuenta, cervezas!.id, 2, 'Se equivocaron de mesa');
    p = obtenerPedido(db, cuenta);
    expect(p.items.map((i) => i.nombre)).toEqual(['Sándwich de milanesa']);
    expect(p.quitados.map((q) => q.motivo)).toEqual(['Salió frío', 'Se equivocaron de mesa']);
    expect(p.totalCentavos).toBe($(23000));
  });

  it('la comanda que ya no tiene nada se va de la pantalla; la que ya está lista se queda', () => {
    const cuenta = sentar(mesa('1'));
    ronda(cuenta, [item('Sándwich de milanesa'), item('Jugo exprimido')], $(15000), minutos(2));
    expect(listarComandas(db, 'todos', minutos(3)).map((c) => c.sector)).toEqual(['cocina', 'barra']);
    const [mila, jugo] = obtenerPedido(db, cuenta).items;

    quitar(cuenta, mila!.id, 1);
    expect(listarComandas(db, 'todos', minutos(3)).map((c) => c.sector)).toEqual(['barra']);
    expect(obtenerPedido(db, cuenta).comandas.map((c) => c.sector)).toEqual(['barra']);

    // El jugo ya salió: se anota que se quitó, pero la comanda lista no se borra.
    const comanda = obtenerPedido(db, cuenta).comandas[0]!;
    cambiarEstadoComanda(db, comanda.id, 'lista', minutos(6));
    quitar(cuenta, jugo!.id, 1);
    expect(obtenerPedido(db, cuenta).comandas).toHaveLength(1);
    expect(obtenerPedido(db, cuenta).totalCentavos).toBe(0);
    expect(estadoDe(salon.obtenerSalon(db).mesas[0]!.id).cuenta?.unidades).toBe(0);
  });

  it('al sacar algo, la propina se borra y "pidió la cuenta" se apaga si queda vacía', () => {
    const cuenta = sentar(mesa('1'));
    ronda(cuenta, [item('Medialuna', 2)], $(1800));
    salon.pedirCuenta(db, cuenta, true, minutos(5));
    cuentaDeMesa.fijarPropina(db, cuenta, $(180));
    const [medialuna] = obtenerPedido(db, cuenta).items;
    quitar(cuenta, medialuna!.id, 1);
    expect(obtenerPedido(db, cuenta)).toMatchObject({ propinaCentavos: 0, totalCentavos: $(900) });
    quitar(cuenta, medialuna!.id, 1);
    expect(obtenerPedido(db, cuenta)).toMatchObject({ totalCentavos: 0, cuentaPedidaEn: null });
  });
});

describe('pasar y juntar mesas', () => {
  it('pasar: la cuenta sigue igual en otra mesa libre', () => {
    const uno = mesa('1');
    const dos = mesa('2');
    const tres = mesa('3');
    const cuenta = sentar(uno);
    ronda(cuenta, [item('Sándwich de milanesa')], $(11500));
    sentar(tres);

    expect(() => cuentaDeMesa.pasarMesa(db, cuenta, uno)).toThrow('Ya están en la mesa 1');
    expect(() => cuentaDeMesa.pasarMesa(db, cuenta, tres)).toThrow('está ocupada');
    cuentaDeMesa.pasarMesa(db, cuenta, dos);
    expect(estadoDe(uno)).toMatchObject({ estado: 'libre', cuenta: null });
    expect(estadoDe(dos).cuenta).toMatchObject({ pedidoId: cuenta, totalCentavos: $(11500) });
    expect(obtenerPedido(db, cuenta)).toMatchObject({ mesa: '2', mesaId: dos });
    // La cocina ve el nombre nuevo.
    expect(listarComandas(db, 'cocina', sabado)[0]!.mesa).toBe('2');
    // Y la mesa que quedó libre se puede volver a usar.
    expect(sentar(uno)).toBeGreaterThan(cuenta);
  });

  it('juntar: las rondas, comandas y quitados pasan a la otra cuenta y la primera queda libre', () => {
    const uno = mesa('1');
    const dos = mesa('2');
    const destino = sentar(uno, 3);
    const origen = sentar(dos, 2);
    ronda(destino, [item('Sándwich de milanesa')], $(11500), minutos(5));
    ronda(destino, [item('Flan casero')], $(4200), minutos(30));
    ronda(origen, [item('Jugo exprimido', 2), item('Medialuna')], $(7900), minutos(10));
    const jugos = obtenerPedido(db, origen).items[0]!;
    quitar(origen, jugos.id, 1, 'Se cayó');
    cuentaDeMesa.fijarPropina(db, destino, $(1000));
    salon.pedirCuenta(db, destino, true, minutos(40));

    expect(() => cuentaDeMesa.juntarMesas(db, destino, destino, yo)).toThrow('otra mesa');
    cuentaDeMesa.juntarMesas(db, origen, destino, yo, minutos(41));

    const p = obtenerPedido(db, destino);
    expect(p).toMatchObject({ comensales: 5, subtotalCentavos: $(11500 + 4200 + 3500 + 900), propinaCentavos: 0, cuentaPedidaEn: null });
    expect(p.totalCentavos).toBe($(20100));
    // Las rondas del origen siguen a continuación (la 1 y la 2 eran del destino).
    expect(p.rondas.map((r) => r.numero)).toEqual([1, 2, 3]);
    expect(p.items.map((i) => [i.nombre, i.ronda])).toEqual([
      ['Sándwich de milanesa', 1],
      ['Flan casero', 2],
      ['Jugo exprimido', 3],
      ['Medialuna', 3],
    ]);
    expect(p.comandas.map((c) => [c.ronda, c.sector]).sort()).toEqual([[1, 'cocina'], [2, 'cocina'], [3, 'barra'], [3, 'cocina']]);
    expect(p.quitados).toMatchObject([{ nombre: 'Jugo exprimido', ronda: 3, motivo: 'Se cayó' }]);

    // La mesa de la cuenta unida queda libre y la cuenta, anulada con su motivo.
    expect(estadoDe(dos)).toMatchObject({ estado: 'libre', cuenta: null });
    expect(obtenerPedido(db, origen)).toMatchObject({ estado: 'anulado', totalCentavos: 0, });
    expect(obtenerPedido(db, origen).motivoAnulacion).toContain('Juntada con la mesa 1');
    expect(obtenerPedido(db, origen).items).toEqual([]);

    // Siguiente ronda: se numera 4; y se cobra todo junto.
    expect(ronda(destino, [item('Medialuna')], $(900), minutos(45)).ronda).toBe(4);
    cobrarPedido(db, destino, esquemaPagos.parse([{ medio: 'efectivo', montoCentavos: $(21000) }]), yo.id);
    expect(estadoDe(uno).estado).toBe('libre');
    expect(() => cuentaDeMesa.juntarMesas(db, origen, destino, yo)).toThrow(); // ya anulada / cobrada
  });
});

describe('reportes del salón', () => {
  it('rendimiento por mozo: solo cuentas cobradas, con propinas aparte', () => {
    const lucas = guardarUsuario(db, { nombre: 'Lucas', rol: 'mozo', pin: '2222' });
    const sofia = guardarUsuario(db, { nombre: 'Sofía', rol: 'mozo', pin: '3333' });
    const cobrada = (n: string, mozo: number, personas: number, plato: string, cantidad: number, total: number, propina: number) => {
      const c = sentar(mesa(n), personas, mozo);
      ronda(c, [item(plato, cantidad)], total);
      if (propina) cuentaDeMesa.fijarPropina(db, c, propina);
      cobrarPedido(db, c, esquemaPagos.parse([{ medio: 'efectivo', montoCentavos: total + propina }]), yo.id);
    };
    cobrada('1', lucas, 4, 'Sándwich de milanesa', 4, $(46000), $(5000));
    cobrada('2', lucas, 2, 'Sándwich de milanesa', 2, $(23000), 0);
    cobrada('3', sofia, 2, 'Lomito completo', 2, $(27800), $(2800));
    sentar(mesa('4'), 2, sofia); // abierta: no cuenta

    const r = obtenerReporteSalon(db, rango('2026-11-14', '2026-11-14'));
    expect(r.mozos.map((x) => x.nombre)).toEqual(['Lucas', 'Sofía']);
    expect(r.mozos[0]).toMatchObject({
      cuentas: 2,
      comensales: 6,
      ventasCentavos: $(69000),
      propinasCentavos: $(5000),
      ticketPromedioCentavos: $(34500),
      porPersonaCentavos: $(11500),
    });
    expect(r.mozos[1]).toMatchObject({ cuentas: 1, ventasCentavos: $(27800), propinasCentavos: $(2800) });
    expect(obtenerReporteSalon(db, rango('2026-11-01', '2026-11-13')).mozos).toEqual([]);
  });

  it('tiempos de cocina y barra, comandas tardías y lo que se quitó', () => {
    const cuenta = sentar(mesa('1'));
    ronda(cuenta, [item('Sándwich de milanesa'), item('Jugo exprimido')], $(15000), minutos(0));
    const comandasDeLaMesa = obtenerPedido(db, cuenta).comandas;
    const cocina = comandasDeLaMesa.find((k) => k.sector === 'cocina');
    const barra = comandasDeLaMesa.find((k) => k.sector === 'barra');
    // Cocina: entra 21:00, la empiezan 21:03, lista 21:15, entregada 21:17 → espera 3, prepara 12, total 15, entrega 2.
    cambiarEstadoComanda(db, cocina!.id, 'preparando', minutos(3));
    cambiarEstadoComanda(db, cocina!.id, 'lista', minutos(15));
    cambiarEstadoComanda(db, cocina!.id, 'entregada', minutos(17));
    // Barra: tardó 25 minutos en total → tardía.
    cambiarEstadoComanda(db, barra!.id, 'preparando', minutos(5));
    cambiarEstadoComanda(db, barra!.id, 'lista', minutos(25));
    // Otra ronda de cocina todavía sin empezar: cuenta como comanda, no ensucia los promedios.
    ronda(cuenta, [item('Flan casero')], $(4200), minutos(30));
    const flan = obtenerPedido(db, cuenta).items.find((i) => i.nombre === 'Flan casero')!;
    quitar(cuenta, flan.id, 1, 'Lo cancelaron');

    const r = obtenerReporteSalon(db, rango('2026-11-14', '2026-11-14'));
    const c = r.cocina.find((x) => x.sector === 'cocina')!;
    expect(c).toMatchObject({ comandas: 1, esperaSeg: 180, preparacionSeg: 720, totalSeg: 900, entregaSeg: 120, tardias: 0 });
    const b = r.cocina.find((x) => x.sector === 'barra')!;
    expect(b).toMatchObject({ comandas: 1, totalSeg: 1500, entregaSeg: null, tardias: 1 });
    expect(r.quitados).toMatchObject({ unidades: 1, montoCentavos: $(4200) });
    expect(r.quitados.lista[0]).toMatchObject({ nombre: 'Flan casero', motivo: 'Lo cancelaron', mesa: '1', usuario: 'Sergio' });
    // Sin datos en el período: ceros y nulos, sin romper.
    const vacio = obtenerReporteSalon(db, rango('2026-01-01', '2026-01-31'));
    expect(vacio.cocina.map((x) => [x.comandas, x.totalSeg])).toEqual([[0, null], [0, null]]);
  });
});

describe('papel de la cuenta dividida', () => {
  it('muestra a cada persona con lo que paga y el total de la mesa', () => {
    const cuenta = sentar(mesa('1'), 2);
    ronda(cuenta, [item('Sándwich de milanesa', 2)], $(23000));
    const html = htmlDivision(
      obtenerPedido(db, cuenta),
      [
        { titulo: 'Persona 1', renglones: [{ texto: '1 × Milanesa napolitana', montoCentavos: $(12500) }], consumoCentavos: $(12500), propinaCentavos: $(1250), totalCentavos: $(13750) },
        { titulo: 'Persona 2', renglones: [{ texto: '1 × Milanesa <napolitana>', montoCentavos: $(12500) }], consumoCentavos: $(12500), propinaCentavos: $(1250), totalCentavos: $(13750) },
      ],
      'Bar',
      80,
    );
    const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(texto).toContain('Cuenta dividida · Mesa 1');
    expect(texto).toContain('Persona 2');
    expect(texto).toContain('PAGA $ 13.750');
    expect(texto).toContain('Total de la mesa $ 27.500');
    expect(html).not.toContain('<napolitana>'); // se escapa
  });
});
