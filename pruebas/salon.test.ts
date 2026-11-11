import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/conexion';
import { MIGRACIONES } from '../src/main/db/migraciones';
import { esquemaAbrirMesa, esquemaMesa, esquemaPagos, esquemaRonda, esquemaZona, type DatosMesa } from '../src/compartido/esquemas';
import { lugarDisponible, primerLugarLibre, duracionCorta, hace, minutosDesde } from '../src/compartido/salon';
import type { Menu, Usuario } from '../src/compartido/tipos';
import * as menu from '../src/main/servicios/menu';
import { cargarMenuDeEjemplo } from '../src/main/servicios/menu-ejemplo';
import { cobrarPedido, obtenerPedido } from '../src/main/servicios/pedidos';
import * as salon from '../src/main/servicios/salon';
import { guardarUsuario } from '../src/main/servicios/usuarios';
import { iniciarSesion, reiniciarSesionParaPruebas } from '../src/main/servicios/sesion';
import { htmlComanda } from '../src/main/impresion/plantillas';
import { $, baseNueva, dueñoConCaja } from './ayudantes';

let db: BaseDeDatos;
let m: Menu;
let yo: Usuario;
let zonaSalon: number;
const sabado = new Date(2026, 10, 14, 21, 0);
const minutos = (n: number) => new Date(sabado.getTime() + n * 60_000);

beforeEach(() => {
  db = baseNueva();
  cargarMenuDeEjemplo(db);
  m = menu.obtenerMenu(db);
  yo = dueñoConCaja(db);
  zonaSalon = salon.obtenerSalon(db).zonas[0]!.id;
});

const producto = (nombre: string) => m.productos.find((p) => p.nombre === nombre)!;
const item = (nombre: string, cantidad = 1) => ({ productoId: producto(nombre).id, varianteId: null, opcionesIds: [], cantidad, nota: '' });
const mesa = (datos: Partial<DatosMesa> & { nombre: string }) =>
  salon.guardarMesa(db, esquemaMesa.parse({ zonaId: zonaSalon, lugares: 4, forma: 'cuadrada', ...datos }));
const ronda = (pedidoId: number, items: ReturnType<typeof item>[], total: number, cuando = sabado) =>
  salon.agregarRonda(db, pedidoId, esquemaRonda.parse({ items, totalEsperadoCentavos: total }), yo, cuando);
const estadoDe = (mesaId: number) => salon.obtenerSalon(db).mesas.find((x) => x.id === mesaId)!;

describe('plano del salón (funciones puras)', () => {
  it('una mesa larga ocupa dos casilleros y no se puede pisar ni salir del plano', () => {
    const otras = [{ id: 1, forma: 'larga' as const, x: 3, y: 0 }];
    expect(lugarDisponible('cuadrada', { x: 3, y: 0 }, otras)).toBe(false);
    expect(lugarDisponible('cuadrada', { x: 4, y: 0 }, otras)).toBe(false); // la mitad derecha de la larga
    expect(lugarDisponible('cuadrada', { x: 5, y: 0 }, otras)).toBe(true);
    expect(lugarDisponible('larga', { x: 2, y: 0 }, otras)).toBe(false); // su derecha pisa a la otra
    expect(lugarDisponible('larga', { x: 9, y: 0 }, [])).toBe(false); // se sale por la derecha (10 columnas)
    expect(lugarDisponible('cuadrada', { x: 0, y: 6 }, [])).toBe(false); // hay 6 filas: 0 a 5
    expect(lugarDisponible('larga', { x: 3, y: 0 }, otras, 1)).toBe(true); // ella misma no cuenta
    expect(primerLugarLibre('larga', [{ id: 1, forma: 'cuadrada', x: 1, y: 0 }])).toEqual({ x: 2, y: 0 });
  });

  it('cuenta minutos y los muestra cortos', () => {
    expect(minutosDesde('2026-11-14 20:15:00', sabado)).toBe(45);
    expect(duracionCorta(45)).toBe('45 min');
    expect(duracionCorta(65)).toBe('1 h 05');
    expect(duracionCorta(120)).toBe('2 h');
    expect(hace(0)).toBe('recién');
    expect(hace(8)).toBe('hace 8 min');
  });
});

describe('zonas y mesas', () => {
  it('ubica las mesas nuevas en el primer lugar libre y no repite nombres', () => {
    const uno = mesa({ nombre: '1' });
    const dos = mesa({ nombre: '2', forma: 'larga', lugares: 8 });
    const s = salon.obtenerSalon(db);
    expect(s.mesas.map(({ nombre, x, y, forma }) => ({ nombre, x, y, forma }))).toEqual([
      { nombre: '1', x: 0, y: 0, forma: 'cuadrada' },
      { nombre: '2', x: 1, y: 0, forma: 'larga' },
    ]);
    expect(() => mesa({ nombre: '1' })).toThrow('Ya hay una mesa "1"');
    expect(() => esquemaMesa.parse({ zonaId: zonaSalon, nombre: 'Mesa larga 1', lugares: 4, forma: 'cuadrada' })).toThrow('hasta 6 caracteres');

    // Mover: no puede pisar a la larga (que ocupa x = 1 y 2), sí ir a un lugar vacío.
    expect(() => salon.moverMesa(db, uno, { x: 2, y: 0 })).toThrow('Ahí no entra');
    salon.moverMesa(db, uno, { x: 5, y: 3 });
    expect(estadoDe(uno)).toMatchObject({ x: 5, y: 3 });

    // Pasarla a larga donde la derecha está ocupada: avisa.
    mesa({ nombre: '3' }); // va a x = 3, y = 0
    salon.moverMesa(db, uno, { x: 2, y: 1 });
    salon.moverMesa(db, salon.obtenerSalon(db).mesas.find((x) => x.nombre === '3')!.id, { x: 3, y: 1 });
    expect(() => salon.guardarMesa(db, esquemaMesa.parse({ id: uno, zonaId: zonaSalon, nombre: '1', lugares: 6, forma: 'larga' }))).toThrow(
      'Larga no entra ahí',
    );
    expect(dos).toBeGreaterThan(0);
  });

  it('las zonas: nombre único, no se borran con mesas y siempre queda una', () => {
    const vereda = salon.guardarZona(db, esquemaZona.parse({ nombre: 'Vereda' }));
    expect(() => salon.guardarZona(db, esquemaZona.parse({ nombre: 'vereda' }))).toThrow('Ya hay una zona');
    const v1 = salon.guardarMesa(db, esquemaMesa.parse({ zonaId: vereda, nombre: 'V1', lugares: 2, forma: 'redonda' }));
    expect(() => salon.darDeBajaZona(db, vereda)).toThrow('todavía tiene mesas');
    // Al cambiarla de zona va al primer lugar libre de la otra.
    salon.guardarMesa(db, esquemaMesa.parse({ id: v1, zonaId: zonaSalon, nombre: 'V1', lugares: 2, forma: 'redonda' }));
    expect(estadoDe(v1)).toMatchObject({ zonaId: zonaSalon, x: 0, y: 0 });
    salon.darDeBajaZona(db, vereda);
    salon.darDeBajaMesa(db, v1);
    expect(() => salon.darDeBajaZona(db, zonaSalon)).toThrow('al menos una zona');
    expect(salon.obtenerSalon(db).zonas.map((z) => z.nombre)).toEqual(['Salón']);
  });
});

describe('cuenta de una mesa', () => {
  it('abrir, sumar rondas, pedir la cuenta, cobrar y queda libre', () => {
    const lucas = guardarUsuario(db, { nombre: 'Lucas', rol: 'mozo', pin: '2222' });
    const cuatro = mesa({ nombre: '4' });
    expect(estadoDe(cuatro).estado).toBe('libre');

    const cuenta = salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: cuatro, comensales: 3, mozoId: lucas }), yo, sabado);
    expect(estadoDe(cuatro)).toMatchObject({ estado: 'ocupada', cuenta: { comensales: 3, mozo: 'Lucas', totalCentavos: 0, rondas: 0 } });
    expect(() => salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: cuatro, comensales: 2, mozoId: null }), yo)).toThrow('ya está ocupada');

    // Ronda 1: 2 tostados ($ 5.200) + 3 cervezas ($ 3.200) = $ 10.400 + $ 9.600 = $ 20.000
    expect(ronda(cuenta, [item('Tostado de jamón y queso', 2), item('Cerveza lata 473 ml', 3)], $(20000), minutos(5))).toEqual({
      ronda: 1,
      rondaCentavos: $(20000),
      totalCentavos: $(20000),
      vaACocina: true,
    });
    // Si el menú cambió mientras cargaban, no se guarda.
    expect(() => ronda(cuenta, [item('Flan casero')], $(4000))).toThrow('ahora suma $ 4.200');
    // Ronda 2: postre. Solo bebidas = no va a la cocina.
    expect(ronda(cuenta, [item('Flan casero', 3)], $(12600), minutos(40))).toMatchObject({ ronda: 2, totalCentavos: $(32600) });
    expect(ronda(cuenta, [item('Cerveza lata 473 ml')], $(3200), minutos(45)).vaACocina).toBe(false);

    const p = obtenerPedido(db, cuenta);
    expect(p).toMatchObject({ tipo: 'mesa', mesa: '4', mesaId: cuatro, comensales: 3, mozo: 'Lucas', totalCentavos: $(35800), cobrado: false });
    expect(p.items.map((i) => [i.nombre, i.ronda])).toEqual([
      ['Tostado de jamón y queso', 1],
      ['Cerveza lata 473 ml', 1],
      ['Flan casero', 2],
      ['Cerveza lata 473 ml', 3],
    ]);
    expect(p.rondas.map((r) => [r.numero, r.hora, r.usuario])).toEqual([
      [1, '21:05', 'Sergio'],
      [2, '21:40', 'Sergio'],
      [3, '21:45', 'Sergio'],
    ]);

    // La comanda de la ronda 2 trae solo el postre, con mesa, mozo y personas.
    const comanda = htmlComanda(p, 80, 2)!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(comanda).toContain('Mesa 4');
    expect(comanda).toContain('Ronda 2');
    expect(comanda).toContain('Lucas · 3 pers.');
    expect(comanda).toContain('3 × Flan casero');
    expect(comanda).not.toContain('Tostado');
    expect(htmlComanda(p, 80, 3)).toBeNull(); // solo una cerveza: nada para la cocina

    salon.pedirCuenta(db, cuenta, true, minutos(70));
    expect(estadoDe(cuatro).estado).toBe('cuenta');
    salon.pedirCuenta(db, cuenta, false);
    expect(estadoDe(cuatro).estado).toBe('ocupada');
    salon.pedirCuenta(db, cuenta, true, minutos(70));
    // Si piden algo más, dejan de "esperar la cuenta".
    ronda(cuenta, [item('Medialuna')], $(900), minutos(72));
    expect(estadoDe(cuatro).estado).toBe('ocupada');

    expect(() => salon.darDeBajaMesa(db, cuatro)).toThrow('tiene una cuenta abierta');
    cobrarPedido(db, cuenta, esquemaPagos.parse([{ medio: 'debito', montoCentavos: $(36700) }]), yo.id);
    expect(obtenerPedido(db, cuenta)).toMatchObject({ cobrado: true, estado: 'entregado' });
    expect(estadoDe(cuatro)).toMatchObject({ estado: 'libre', cuenta: null });
    expect(() => ronda(cuenta, [item('Medialuna')], $(900))).toThrow('ya se cobró');

    // La mesa se puede volver a abrir, con un número de pedido nuevo.
    const otra = salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: cuatro, comensales: 2, mozoId: null }), yo, minutos(90));
    expect(obtenerPedido(db, otra).numero).toBe(2);
  });

  it('la base no deja dos cuentas abiertas en la misma mesa (índice único parcial)', () => {
    const uno = mesa({ nombre: '1' });
    salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: uno, comensales: 2, mozoId: null }), yo, sabado);
    const insertar = () =>
      db.$client
        .prepare(
          `INSERT INTO pedidos (numero, fecha, hora, tipo, mesa, mesa_id, subtotal_centavos, total_centavos, cobrado)
           VALUES (99, '2026-11-14', '21:00', 'mesa', '1', ?, 0, 0, 0)`,
        )
        .run(uno);
    expect(insertar).toThrow('UNIQUE');
  });

  it('liberar solo una mesa sin consumo; una mesa vacía no se cobra', () => {
    const uno = mesa({ nombre: '1' });
    const cuenta = salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: uno, comensales: 2, mozoId: null }), yo, sabado);
    expect(() => salon.pedirCuenta(db, cuenta, true)).toThrow('todavía no pidió nada');
    expect(() => cobrarPedido(db, cuenta, esquemaPagos.parse([{ medio: 'efectivo', montoCentavos: 1 }]), yo.id)).toThrow();
    salon.liberarMesa(db, cuenta, yo);
    expect(obtenerPedido(db, cuenta)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'Mesa liberada sin consumo' });
    expect(estadoDe(uno).estado).toBe('libre');

    const otra = salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: uno, comensales: 2, mozoId: null }), yo, sabado);
    ronda(otra, [item('Medialuna')], $(900));
    expect(() => salon.liberarMesa(db, otra, yo)).toThrow('ya pidió');
  });

  it('el mozo tiene que estar en el equipo; los mozos no entran a la PC', () => {
    const uno = mesa({ nombre: '1' });
    expect(() => salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId: uno, comensales: 2, mozoId: 999 }), yo)).toThrow('ya no está en el equipo');
    const sofia = guardarUsuario(db, { nombre: 'Sofía', rol: 'mozo', pin: '3333' });
    reiniciarSesionParaPruebas();
    expect(() => iniciarSesion(db, sofia, '3333')).toThrow('desde el celular');
    expect(salon.obtenerSalon(db).mozos.map((u) => u.nombre)).toEqual(['Sofía', 'Sergio']); // mozos primero
  });

  it('el salón de ejemplo arma 2 zonas, 18 mesas, 2 mozos y algunas mesas ocupadas', () => {
    const r = salon.cargarSalonEjemplo(db, yo, sabado);
    expect(r).toEqual({ mesas: 18, mozos: [{ nombre: 'Lucas', pin: '2222' }, { nombre: 'Sofía', pin: '3333' }], abiertas: 5 });
    const s = salon.obtenerSalon(db);
    expect(s.zonas.map((z) => z.nombre)).toEqual(['Salón', 'Vereda']);
    expect(s.mesas.filter((x) => x.estado !== 'libre')).toHaveLength(5);
    expect(s.mesas.filter((x) => x.estado === 'cuenta').map((x) => x.nombre)).toEqual(['1']);
    expect(s.mesas.every((x) => x.estado === 'libre' || x.cuenta!.totalCentavos > 0)).toBe(true);
    expect(() => salon.cargarSalonEjemplo(db, yo, sabado)).toThrow('Ya hay mesas');
  });
});

describe('migración 7 sobre una base de la Caja con datos', () => {
  it('rearma usuarios con el rol mozo sin romper pedidos, pagos ni cajas', () => {
    const carpeta = mkdtempSync(path.join(tmpdir(), 'comandas-'));
    const ruta = path.join(carpeta, 'comandas.db');
    try {
      const vieja = new Database(ruta);
      vieja.pragma('foreign_keys = ON');
      MIGRACIONES.slice(0, 6).forEach((mg, i) => {
        vieja.exec(mg.sql);
        vieja.pragma(`user_version = ${i + 1}`);
      });
      vieja.exec(`
        INSERT INTO usuarios (id, nombre, rol, pin_hash, pin_sal) VALUES (5, 'Marta', 'cajero', 'h', 's'), (9, 'Sergio', 'dueno', 'h', 's');
        INSERT INTO cajas (id, abierta_en, abierta_por, fondo_centavos) VALUES (1, '2026-11-10 09:00:00', 5, 2000000);
        INSERT INTO pedidos (id, numero, fecha, hora, tipo, mesa, subtotal_centavos, total_centavos, usuario_id)
          VALUES (1, 1, '2026-11-10', '12:00', 'mesa', '7', 520000, 520000, 5);
        INSERT INTO pagos (pedido_id, medio, monto_centavos, recibido_centavos, caja_id, usuario_id) VALUES (1, 'efectivo', 520000, 520000, 1, 5);
      `);
      vieja.close();

      cerrarBaseDeDatos();
      const base = abrirBaseDeDatos(ruta);
      const c = base.$client;
      expect(c.pragma('user_version', { simple: true })).toBe(MIGRACIONES.length);
      expect(c.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(c.pragma('foreign_key_check')).toEqual([]);
      expect(c.prepare('SELECT id, nombre, rol FROM usuarios ORDER BY id').all()).toEqual([
        { id: 5, nombre: 'Marta', rol: 'cajero' },
        { id: 9, nombre: 'Sergio', rol: 'dueno' },
      ]);
      // Las claves foráneas siguen apuntando a "usuarios" (no a "usuarios_nueva").
      const fks = c.prepare("SELECT \"table\" FROM pragma_foreign_key_list('pagos')").all() as { table: string }[];
      expect(fks.map((f) => f.table).sort()).toEqual(['cajas', 'pedidos', 'usuarios']);
      expect(() => c.prepare("INSERT INTO pagos (pedido_id, medio, monto_centavos, recibido_centavos, usuario_id) VALUES (1, 'qr', 1, 1, 77)").run()).toThrow(
        'FOREIGN KEY',
      );
      // El pedido viejo de mesa queda como estaba (sin mesa del plano) y aparece la zona Salón.
      expect(obtenerPedido(base, 1)).toMatchObject({ mesa: '7', mesaId: null, rondas: [], items: [] });
      expect(c.prepare('SELECT nombre FROM zonas').all()).toEqual([{ nombre: 'Salón' }]);
      guardarUsuario(base, { nombre: 'Lucas', rol: 'mozo', pin: '2222' });
      expect(c.prepare("SELECT count(*) AS n FROM usuarios WHERE rol = 'mozo'").get()).toEqual({ n: 1 });
      expect(c.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'usuarios_nueva'").get()).toEqual({ n: 0 });
    } finally {
      cerrarBaseDeDatos();
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
});
