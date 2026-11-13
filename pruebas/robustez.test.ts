import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { VERSION_BASE, abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/conexion';
import { esquemaAbrirMesa, esquemaMesa, esquemaRonda } from '../src/compartido/esquemas';
import type { Menu, Usuario } from '../src/compartido/tipos';
import * as menu from '../src/main/servicios/menu';
import { cargarMenuDeEjemplo } from '../src/main/servicios/menu-ejemplo';
import { obtenerPedido } from '../src/main/servicios/pedidos';
import * as salon from '../src/main/servicios/salon';
import { listarComandas } from '../src/main/servicios/comandas';
import { baseNueva, dueñoConCaja } from './ayudantes';

let db: BaseDeDatos;
let m: Menu;
let yo: Usuario;
const sabado = new Date(2026, 10, 14, 21, 0);

beforeEach(() => {
  db = baseNueva();
  cargarMenuDeEjemplo(db);
  m = menu.obtenerMenu(db);
  yo = dueñoConCaja(db);
});

const producto = (nombre: string) => m.productos.find((p) => p.nombre === nombre)!;
const item = (nombre: string, cantidad = 1) => ({ productoId: producto(nombre).id, varianteId: null, opcionesIds: [], cantidad, nota: '' });

function cuentaAbierta(): number {
  const zona = salon.obtenerSalon(db).zonas[0]!.id;
  const mesaId = salon.guardarMesa(db, esquemaMesa.parse({ zonaId: zona, nombre: '1', lugares: 4, forma: 'cuadrada' }));
  return salon.abrirMesa(db, esquemaAbrirMesa.parse({ mesaId, comensales: 2, mozoId: null }), yo, sabado);
}

describe('ronda mandada dos veces (se cortó el wifi y el celular reintentó)', () => {
  it('con la misma clave de envío, la ronda se carga una sola vez', () => {
    const pedidoId = cuentaAbierta();
    const total = producto('Sándwich de milanesa').precioCentavos * 2;
    const datos = esquemaRonda.parse({ items: [item('Sándwich de milanesa', 2)], totalEsperadoCentavos: total, claveEnvio: 'abc12345-xyz' });

    const primera = salon.agregarRonda(db, pedidoId, datos, yo, sabado);
    const segunda = salon.agregarRonda(db, pedidoId, datos, yo, sabado);

    expect(primera.repetida).toBe(undefined);
    expect(segunda).toMatchObject({ ronda: 1, rondaCentavos: total, totalCentavos: total, repetida: true });
    const cuenta = obtenerPedido(db, pedidoId);
    expect(cuenta.items.reduce((s, i) => s + i.cantidad, 0)).toBe(2); // no se duplicó nada
    expect(cuenta.totalCentavos).toBe(total);
    expect(listarComandas(db, 'todos', sabado)).toHaveLength(1); // ni se duplicó en la cocina
  });

  it('con otra clave (el mozo cambió el pedido), es una ronda nueva', () => {
    const pedidoId = cuentaAbierta();
    const unidad = producto('Sándwich de milanesa').precioCentavos;
    salon.agregarRonda(db, pedidoId, esquemaRonda.parse({ items: [item('Sándwich de milanesa')], totalEsperadoCentavos: unidad, claveEnvio: 'clave-uno-1' }), yo, sabado);
    const r2 = salon.agregarRonda(db, pedidoId, esquemaRonda.parse({ items: [item('Sándwich de milanesa')], totalEsperadoCentavos: unidad, claveEnvio: 'clave-dos-2' }), yo, sabado);
    expect(r2.ronda).toBe(2);
    expect(obtenerPedido(db, pedidoId).totalCentavos).toBe(unidad * 2);
  });

  it('sin clave (la ventana de la PC) cada envío es una ronda', () => {
    const pedidoId = cuentaAbierta();
    const unidad = producto('Sándwich de milanesa').precioCentavos;
    const datos = esquemaRonda.parse({ items: [item('Sándwich de milanesa')], totalEsperadoCentavos: unidad });
    salon.agregarRonda(db, pedidoId, datos, yo, sabado);
    expect(salon.agregarRonda(db, pedidoId, datos, yo, sabado).ronda).toBe(2);
  });
});

describe('copia de seguridad antes de actualizar la base', () => {
  let carpeta: string;
  beforeEach(() => {
    cerrarBaseDeDatos();
    carpeta = mkdtempSync(path.join(os.tmpdir(), 'comandas-robustez-'));
  });

  function baseDeLaVersionAnterior(ruta: string): void {
    // Una base "vieja": la de ahora, con la última migración deshecha.
    const nueva = abrirBaseDeDatos(ruta);
    nueva.$client.exec('DROP INDEX rondas_clave_envio; ALTER TABLE rondas DROP COLUMN clave_envio;');
    nueva.$client.pragma(`user_version = ${VERSION_BASE - 1}`);
    nueva.$client.prepare("INSERT INTO usuarios (nombre, rol, pin_hash, pin_sal, activo) VALUES ('Vieja', 'dueno', 'x', 'y', 1)").run();
    cerrarBaseDeDatos();
  }

  it('si hay migraciones pendientes en una base con datos, guarda una copia ANTES de aplicarlas', () => {
    const ruta = path.join(carpeta, 'comandas.db');
    baseDeLaVersionAnterior(ruta);
    const copia = path.join(carpeta, 'previa.db');
    let versionVista = -1;

    abrirBaseDeDatos(ruta, { copiaAntesDeActualizar: (v) => ((versionVista = v), copia) });

    expect(versionVista).toBe(VERSION_BASE - 1);
    expect(existsSync(copia)).toBe(true);
    const enLaCopia = new Database(copia, { readonly: true });
    expect(Number(enLaCopia.pragma('user_version', { simple: true }))).toBe(VERSION_BASE - 1); // la de antes de actualizar
    expect(enLaCopia.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE nombre = 'Vieja'").get()).toEqual({ n: 1 });
    enLaCopia.close();
    cerrarBaseDeDatos(); // en Windows no se puede borrar una carpeta con la base todavía abierta
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
  });

  it('en una base nueva o ya actualizada no hace copia', () => {
    const ruta = path.join(carpeta, 'comandas.db');
    let llamadas = 0;
    abrirBaseDeDatos(ruta, { copiaAntesDeActualizar: () => (llamadas++, path.join(carpeta, 'x.db')) });
    cerrarBaseDeDatos();
    abrirBaseDeDatos(ruta, { copiaAntesDeActualizar: () => (llamadas++, path.join(carpeta, 'x.db')) });
    expect(llamadas).toBe(0);
    expect(readdirSync(carpeta).filter((n) => n === 'x.db')).toHaveLength(0);
    cerrarBaseDeDatos();
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
  });

  it('si la copia falla, igual se actualiza (no se deja al local sin sistema)', () => {
    const ruta = path.join(carpeta, 'comandas.db');
    baseDeLaVersionAnterior(ruta);
    const db2 = abrirBaseDeDatos(ruta, { copiaAntesDeActualizar: () => path.join(carpeta, 'no-existe', 'previa.db') });
    expect(Number(db2.$client.pragma('user_version', { simple: true }))).toBe(VERSION_BASE);
    cerrarBaseDeDatos();
    rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
  });
});
