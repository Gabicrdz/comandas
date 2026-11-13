import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/conexion';
import { MIGRACIONES } from '../src/main/db/migraciones';
import { esquemaAbrirMesa, esquemaEstado, esquemaMesa, esquemaPedido, esquemaProducto, esquemaRonda } from '../src/compartido/esquemas';
import type { Cambio, Comanda, Menu, Usuario } from '../src/compartido/tipos';
import * as menu from '../src/main/servicios/menu';
import { cargarMenuDeEjemplo } from '../src/main/servicios/menu-ejemplo';
import { anularPedido, cambiarEstado, crearPedido, obtenerPedido } from '../src/main/servicios/pedidos';
import * as salon from '../src/main/servicios/salon';
import { cambiarEstadoComanda, listarComandas } from '../src/main/servicios/comandas';
import { guardarUsuario } from '../src/main/servicios/usuarios';
import { reiniciarSesionParaPruebas } from '../src/main/servicios/sesion';
import { cambiarPinCocina, reiniciarIntentosCocina } from '../src/main/red/cocina';
import { escucharCambios } from '../src/main/red/avisos';
import { detenerServidor, iniciarServidor } from '../src/main/red/servidor';
import { $, baseNueva, dueñoConCaja } from './ayudantes';

let db: BaseDeDatos;
let m: Menu;
let yo: Usuario;
const sabado = new Date(2026, 10, 14, 21, 0);
const minutos = (n: number) => new Date(sabado.getTime() + n * 60_000);

beforeEach(() => {
  db = baseNueva();
  cargarMenuDeEjemplo(db);
  m = menu.obtenerMenu(db);
  yo = dueñoConCaja(db);
});

const producto = (nombre: string) => m.productos.find((p) => p.nombre === nombre)!;
const item = (nombre: string, cantidad = 1, variante?: string) => {
  const p = producto(nombre);
  return { productoId: p.id, varianteId: variante ? p.variantes.find((v) => v.nombre === variante)!.id : null, opcionesIds: [], cantidad, nota: '' };
};

function mesaConRonda() {
  const zona = salon.obtenerSalon(db).zonas[0]!.id;
  const mesaId = salon.guardarMesa(db, esquemaMesa.parse({ zonaId: zona, nombre: '4', lugares: 4, forma: 'cuadrada' }));
  const lucas = guardarUsuario(db, { nombre: 'Lucas', rol: 'mozo', pin: '2222' });
  const pedidoId = salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId, comensales: 3, mozoId: lucas }), yo, sabado);
  // 2 tostados (cocina) + 1 café chico (barra) + 1 cerveza (no se prepara)
  salon.agregarRonda(
    db,
    pedidoId,
    esquemaRonda.parse({
      items: [item('Tostado de jamón y queso', 2), item('Café', 1, 'Chico'), item('Cerveza lata 473 ml')],
      totalEsperadoCentavos: $(10400 + 1900 + 3200),
    }),
    yo,
    minutos(2),
  );
  return { pedidoId, lucas };
}

describe('sectores de los productos', () => {
  it('cada producto se prepara en cocina, en barra o en ningún lado', () => {
    expect(producto('Tostado de jamón y queso').sector).toBe('cocina');
    expect(producto('Café').sector).toBe('barra');
    expect(producto('Cerveza lata 473 ml')).toMatchObject({ vaACocina: false, sector: null });
    const base = { categoriaId: producto('Café').categoriaId, nombre: 'Licuado', precioCentavos: $(3000) };
    const licuado = menu.guardarProducto(db, esquemaProducto.parse({ ...base, sector: 'barra' }));
    const agua = menu.guardarProducto(db, esquemaProducto.parse({ ...base, nombre: 'Soda', vaACocina: false }));
    const lista = menu.obtenerMenu(db).productos;
    expect(lista.find((p) => p.id === licuado)).toMatchObject({ vaACocina: true, sector: 'barra' });
    expect(lista.find((p) => p.id === agua)).toMatchObject({ vaACocina: false, sector: null }); // sin preparar no hay sector
  });
});

describe('comandas', () => {
  it('una ronda con cocina y barra arma dos comandas; cada pantalla ve lo suyo', () => {
    const { pedidoId } = mesaConRonda();
    const todas = listarComandas(db, 'todos', minutos(5));
    // En orden de llegada (las dos llegaron juntas: primero la que se creó primero).
    expect(todas.map((c) => [c.sector, c.estado, c.mesa, c.ronda, c.mozo])).toEqual([
      ['cocina', 'pendiente', '4', 1, 'Lucas'],
      ['barra', 'pendiente', '4', 1, 'Lucas'],
    ]);
    const [cocina] = listarComandas(db, 'cocina', minutos(5));
    expect(cocina!.items.map((i) => `${i.cantidad} ${i.nombre}`)).toEqual(['2 Tostado de jamón y queso']);
    const [barra] = listarComandas(db, 'barra', minutos(5));
    expect(barra!.items.map((i) => `${i.cantidad} ${i.nombre} ${i.varianteNombre}`)).toEqual(['1 Café Chico']);
    // La cuenta de la mesa trae las comandas con su estado.
    expect(obtenerPedido(db, pedidoId).comandas.map((c) => [c.sector, c.estado])).toEqual([
      ['barra', 'pendiente'],
      ['cocina', 'pendiente'],
    ]);
    // Una ronda solo de bebidas envasadas no manda nada a la cocina.
    salon.agregarRonda(db, pedidoId, esquemaRonda.parse({ items: [item('Cerveza lata 473 ml')], totalEsperadoCentavos: $(3200) }), yo, minutos(20));
    expect(listarComandas(db, 'todos', minutos(21))).toHaveLength(2);
  });

  it('estados: avanzar (aunque sea salteando), volver un solo paso y nada después de entregada', () => {
    mesaConRonda();
    const cocina = (): Comanda => listarComandas(db, 'cocina', minutos(5))[0]!;
    const id = cocina().id;
    cambiarEstadoComanda(db, id, 'preparando', minutos(3));
    expect(cocina()).toMatchObject({ estado: 'preparando', empezadaEn: '2026-11-14 21:03:00' });
    const lista = cambiarEstadoComanda(db, id, 'lista', minutos(12));
    expect(lista).toMatchObject({ estado: 'lista', mesa: '4', sector: 'cocina', ronda: 1 });
    expect(cocina()).toMatchObject({ estado: 'lista', listaEn: '2026-11-14 21:12:00' });
    expect(() => cambiarEstadoComanda(db, id, 'pendiente')).toThrow('un paso atrás');
    cambiarEstadoComanda(db, id, 'preparando', minutos(13)); // se tocó sin querer
    expect(cocina()).toMatchObject({ estado: 'preparando', listaEn: null, empezadaEn: '2026-11-14 21:03:00' });
    cambiarEstadoComanda(db, id, 'lista', minutos(14));
    cambiarEstadoComanda(db, id, 'entregada', minutos(16));
    expect(listarComandas(db, 'cocina', minutos(17))).toHaveLength(0); // ya no se ve
    expect(() => cambiarEstadoComanda(db, id, 'lista')).toThrow('ya se entregó');
    // La barra salta directo a lista.
    const barra = listarComandas(db, 'barra', minutos(5))[0]!;
    cambiarEstadoComanda(db, barra.id, 'lista', minutos(4));
    expect(listarComandas(db, 'barra', minutos(5))[0]).toMatchObject({ estado: 'lista', empezadaEn: '2026-11-14 21:04:00' });
    // Las listas que nadie entregó desaparecen de la pantalla después de una hora.
    expect(listarComandas(db, 'barra', minutos(70))).toHaveLength(0);
  });

  it('en mostrador el tablero de Pedidos sigue a la cocina, y al revés', () => {
    const datos = esquemaPedido.parse({
      tipo: 'llevar',
      clienteNombre: 'Ana',
      items: [item('Tostado de jamón y queso'), item('Café', 1, 'Chico')],
      totalEsperadoCentavos: $(5200 + 1900),
      pagos: [{ medio: 'efectivo', montoCentavos: $(7100) }],
    });
    const p = crearPedido(db, datos, sabado, yo.id);
    const delPedido = listarComandas(db, 'todos', minutos(1));
    const barra = delPedido.find((c) => c.sector === 'barra');
    const cocina = delPedido.find((c) => c.sector === 'cocina');
    expect([barra!.clienteNombre, barra!.tipo, barra!.mesa]).toEqual(['Ana', 'llevar', '']);
    cambiarEstadoComanda(db, cocina!.id, 'preparando');
    expect(obtenerPedido(db, p.id).estado).toBe('en_preparacion');
    cambiarEstadoComanda(db, cocina!.id, 'lista');
    expect(obtenerPedido(db, p.id).estado).toBe('en_preparacion'); // falta la barra
    cambiarEstadoComanda(db, barra!.id, 'lista');
    expect(obtenerPedido(db, p.id).estado).toBe('listo');
    // Entregado desde el tablero: las comandas también.
    cambiarEstado(db, p.id, esquemaEstado.parse('entregado'));
    expect(obtenerPedido(db, p.id).comandas.map((c) => c.estado)).toEqual(['entregada', 'entregada']);

    // Otro pedido: lo marcan "listo" en el tablero sin usar la pantalla.
    const otro = crearPedido(db, { ...datos, clienteNombre: 'Beto' }, sabado, yo.id);
    cambiarEstado(db, otro.id, esquemaEstado.parse('listo'));
    expect(obtenerPedido(db, otro.id).comandas.map((c) => c.estado)).toEqual(['lista', 'lista']);
    // Anulado: desaparece de la cocina y ya no se puede mover.
    const tercero = crearPedido(db, { ...datos, clienteNombre: 'Caro' }, sabado, yo.id);
    anularPedido(db, tercero.id, 'Se arrepintió', yo.id);
    expect(listarComandas(db, 'todos', minutos(1)).map((c) => c.clienteNombre)).not.toContain('Caro');
    const deCaro = obtenerPedido(db, tercero.id).comandas[0]!;
    expect(() => cambiarEstadoComanda(db, deCaro.id, 'lista')).toThrow('fue anulado');
  });
});

describe('pantalla de cocina por la red', () => {
  let base: string;
  let carpetaApp: string;
  beforeEach(async () => {
    reiniciarSesionParaPruebas();
    reiniciarIntentosCocina();
    carpetaApp = mkdtempSync(path.join(tmpdir(), 'comandas-app-'));
    mkdirSync(path.join(carpetaApp, 'assets'));
    writeFileSync(path.join(carpetaApp, 'cocina.html'), '<title>Cocina</title>');
    const puerto = await iniciarServidor({ puerto: 0, obtenerDb: () => db, carpetaApp, urlDesarrollo: null });
    base = `http://127.0.0.1:${puerto}`;
  });
  afterEach(async () => {
    await detenerServidor();
    rmSync(carpetaApp, { recursive: true, force: true });
  });
  const pedir = async <T,>(ruta: string, token?: string, cuerpo?: unknown) => {
    const r = await fetch(base + ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { estado: r.status, datos: (await r.json()) as T };
  };

  it('entra con el PIN de cocina, ve las comandas y las mueve; el mozo marca entregada', async () => {
    const { lucas } = mesaConRonda();
    expect((await pedir<{ error: string }>('/api/cocina/ingresar', undefined, { pin: '1234' })).datos.error).toContain('Todavía no hay PIN de cocina');
    cambiarPinCocina(db, '4321');
    expect((await pedir('/api/cocina/ingresar', undefined, { pin: '1111' })).estado).toBe(401);
    const { datos } = await pedir<{ token: string }>('/api/cocina/ingresar', undefined, { pin: '4321' });
    const cocina = datos.token;

    const lista = await pedir<Comanda[]>('/api/cocina/comandas?sector=cocina', cocina);
    expect(lista.datos.map((c) => c.items.length)).toEqual([1]);
    const avisos: Cambio[] = [];
    const dejar = escucharCambios((c) => avisos.push(c));
    await pedir(`/api/cocina/comandas/${lista.datos[0]!.id}/estado`, cocina, { estado: 'lista' });
    expect(avisos[0]).toMatchObject({ tipo: 'comanda', estado: 'lista', mesa: '4', sector: 'cocina', mozoId: lucas });

    // Cada token sirve solo para lo suyo.
    expect((await pedir('/api/salon', cocina)).estado).toBe(401);
    const mozo = (await pedir<{ token: string }>('/api/ingresar', undefined, { usuarioId: lucas, pin: '2222' })).datos.token;
    expect((await pedir('/api/cocina/comandas', mozo)).estado).toBe(401);
    // El mozo llevó el plato a la mesa.
    expect((await pedir(`/api/comandas/${lista.datos[0]!.id}/entregada`, mozo, {})).estado).toBe(200);
    expect(avisos[1]).toMatchObject({ tipo: 'comanda', estado: 'entregada' });
    dejar();
    expect((await pedir<Comanda[]>('/api/cocina/comandas?sector=cocina', cocina)).datos).toEqual([]);
    // /cocina es la página de la pantalla.
    expect(await (await fetch(base + '/cocina')).text()).toContain('<title>Cocina</title>');
  });
});

describe('migración 8 sobre una base de la etapa 2', () => {
  it('lo que iba a la cocina queda en el sector cocina', () => {
    const carpeta = mkdtempSync(path.join(tmpdir(), 'comandas-'));
    const ruta = path.join(carpeta, 'comandas.db');
    try {
      const vieja = new Database(ruta);
      vieja.pragma('foreign_keys = ON');
      MIGRACIONES.slice(0, 7).forEach((mg, i) => {
        vieja.exec(mg.sql);
        vieja.pragma(`user_version = ${i + 1}`);
      });
      vieja.exec(`
        INSERT INTO categorias (id, nombre) VALUES (1, 'Todo');
        INSERT INTO productos (id, categoria_id, nombre, precio_centavos, va_a_cocina) VALUES (1, 1, 'Pizza', 100, 1), (2, 1, 'Agua', 50, 0);
      `);
      vieja.close();
      cerrarBaseDeDatos();
      const nueva = abrirBaseDeDatos(ruta);
      expect(nueva.$client.prepare('SELECT nombre, sector FROM productos ORDER BY id').all()).toEqual([
        { nombre: 'Pizza', sector: 'cocina' },
        { nombre: 'Agua', sector: null },
      ]);
      expect(nueva.$client.pragma('user_version', { simple: true })).toBe(MIGRACIONES.length);
    } finally {
      cerrarBaseDeDatos();
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
