import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BaseDeDatos } from '../src/main/db/conexion';
import { esquemaMesa } from '../src/compartido/esquemas';
import { generarQr } from '../src/compartido/qr';
import type { Cambio, Menu, PedidoDetalle, Salon } from '../src/compartido/tipos';
import * as menu from '../src/main/servicios/menu';
import { cargarMenuDeEjemplo } from '../src/main/servicios/menu-ejemplo';
import { guardarMesa } from '../src/main/servicios/salon';
import { guardarUsuario } from '../src/main/servicios/usuarios';
import { reiniciarSesionParaPruebas } from '../src/main/servicios/sesion';
import { guardarRed } from '../src/main/servicios/configuracion';
import { escucharCambios } from '../src/main/red/avisos';
import { esDeLaRedLocal } from '../src/main/red/redes';
import { crearControlRed } from '../src/main/red/control';
import { detenerServidor, iniciarServidor } from '../src/main/red/servidor';
import { $, baseNueva, dueñoConCaja } from './ayudantes';

let db: BaseDeDatos;
let m: Menu;
let base: string;
let lucas: number;
let carpetaApp: string;

beforeEach(async () => {
  reiniciarSesionParaPruebas();
  db = baseNueva();
  cargarMenuDeEjemplo(db);
  m = menu.obtenerMenu(db);
  dueñoConCaja(db);
  lucas = guardarUsuario(db, { nombre: 'Lucas', rol: 'mozo', pin: '2222' });
  const zona = (await import('../src/main/servicios/salon')).obtenerSalon(db).zonas[0]!.id;
  guardarMesa(db, esquemaMesa.parse({ zonaId: zona, nombre: '4', lugares: 4, forma: 'cuadrada' }));
  // Una "app instalada" de mentira: mozo.html, un archivo en assets y uno que NO se debe servir.
  carpetaApp = mkdtempSync(path.join(tmpdir(), 'comandas-app-'));
  mkdirSync(path.join(carpetaApp, 'assets'));
  writeFileSync(path.join(carpetaApp, 'mozo.html'), '<!doctype html><title>Mozo</title>');
  writeFileSync(path.join(carpetaApp, 'index.html'), 'pantalla de la PC');
  writeFileSync(path.join(carpetaApp, 'assets', 'app-123.js'), 'console.log(1)');
  const puerto = await iniciarServidor({ puerto: 0, obtenerDb: () => db, carpetaApp, urlDesarrollo: null });
  base = `http://127.0.0.1:${puerto}`;
});

afterEach(async () => {
  await detenerServidor();
  rmSync(carpetaApp, { recursive: true, force: true });
});

async function pedir<T = unknown>(ruta: string, opciones: { metodo?: string; token?: string; cuerpo?: unknown } = {}) {
  const r = await fetch(base + ruta, {
    method: opciones.metodo ?? (opciones.cuerpo !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}) },
    body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  return { estado: r.status, datos: (await r.json()) as T };
}

async function entrar(): Promise<string> {
  const r = await pedir<{ token: string }>('/api/ingresar', { cuerpo: { usuarioId: lucas, pin: '2222' } });
  expect(r.estado).toBe(200);
  return r.datos.token;
}

describe('servidor de la red local', () => {
  it('sin PIN solo muestra el nombre del local y el equipo (sin datos secretos)', async () => {
    expect((await pedir('/api/hola')).datos).toEqual({ local: 'Mi Local' });
    const equipo = await pedir<{ nombre: string }[]>('/api/equipo');
    expect(equipo.datos.map((u) => u.nombre)).toEqual(['Lucas', 'Sergio']); // mozos primero
    expect(JSON.stringify(equipo.datos)).not.toContain('pin');
    expect((await pedir('/api/salon')).estado).toBe(401);
    expect((await pedir('/api/salon', { token: 'inventado' })).estado).toBe(401);
  });

  it('el PIN se revisa como en la PC: mal → 401, y a los 5 errores hay que esperar', async () => {
    const mal = await pedir<{ error: string }>('/api/ingresar', { cuerpo: { usuarioId: lucas, pin: '9999' } });
    expect(mal).toEqual({ estado: 401, datos: { error: 'PIN incorrecto.' } });
    for (let i = 0; i < 4; i++) await pedir('/api/ingresar', { cuerpo: { usuarioId: lucas, pin: '9999' } });
    const bien = await pedir<{ error: string }>('/api/ingresar', { cuerpo: { usuarioId: lucas, pin: '2222' } });
    expect(bien.estado).toBe(401);
    expect(/Esperá \d+ segundos/.test(bien.datos.error)).toBe(true);
  });

  it('un mozo abre una mesa, manda una ronda y pide la cuenta; todo se avisa', async () => {
    const token = await entrar();
    expect((await pedir('/api/yo', { token })).datos).toMatchObject({ nombre: 'Lucas', rol: 'mozo' });
    const avisos: Cambio[] = [];
    const dejar = escucharCambios((c) => avisos.push(c));

    const s = (await pedir<Salon>('/api/salon', { token })).datos;
    const mesa = s.mesas[0]!;
    const abierta = await pedir<number>(`/api/mesas/${mesa.id}/abrir`, { token, cuerpo: { comensales: 2 } });
    expect(abierta.estado).toBe(200);
    const pedidoId = abierta.datos;

    const tostado = m.productos.find((p) => p.nombre === 'Tostado de jamón y queso')!;
    const items = [{ productoId: tostado.id, varianteId: null, opcionesIds: [], cantidad: 2, nota: 'sin manteca' }];
    // Si el total no coincide (cambió un precio), no se guarda.
    const mal = await pedir<{ error: string }>(`/api/cuentas/${pedidoId}/rondas`, { token, cuerpo: { items, totalEsperadoCentavos: 1 } });
    expect(mal.estado).toBe(400);
    expect(mal.datos.error).toContain('ahora suma');
    const ronda = await pedir(`/api/cuentas/${pedidoId}/rondas`, { token, cuerpo: { items, totalEsperadoCentavos: $(10400) } });
    expect(ronda.datos).toEqual({ ronda: 1, rondaCentavos: $(10400), totalCentavos: $(10400), vaACocina: true });
    await pedir(`/api/cuentas/${pedidoId}/cuenta`, { token, cuerpo: { pedida: true } });

    const cuenta = (await pedir<PedidoDetalle>(`/api/cuentas/${pedidoId}`, { token })).datos;
    // El mozo queda como quien atiende y como quien cargó la ronda.
    expect(cuenta).toMatchObject({ mesa: '4', comensales: 2, mozo: 'Lucas', totalCentavos: $(10400) });
    expect(cuenta.rondas[0]).toMatchObject({ numero: 1, usuario: 'Lucas' });
    expect(cuenta.cuentaPedidaEn).not.toBeNull();
    expect(avisos).toEqual([
      { tipo: 'salon' },
      { tipo: 'ronda', origen: 'celular', pedidoId, ronda: 1, mesa: '4', quien: 'Lucas', vaACocina: true },
      { tipo: 'cuenta', origen: 'celular', mesa: '4', quien: 'Lucas' },
    ]);
    dejar();

    // Datos inválidos → 400 con el mensaje de Zod.
    expect((await pedir(`/api/mesas/${mesa.id}/abrir`, { token, cuerpo: { comensales: 0 } })).datos).toEqual({ error: 'Al menos 1 persona.' });
    // Cerrar sesión: el token deja de servir.
    await pedir('/api/salir', { token, cuerpo: {} });
    expect((await pedir('/api/salon', { token })).estado).toBe(401);
  });

  it('dar de baja a un mozo lo saca también del celular', async () => {
    const token = await entrar();
    db.$client.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(lucas);
    expect((await pedir('/api/salon', { token })).estado).toBe(401);
  });

  it('los avisos llegan al celular por SSE (Server-Sent Events)', async () => {
    const token = await entrar();
    const control = new AbortController();
    const r = await fetch(`${base}/api/eventos?token=${token}`, { signal: control.signal });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const lector = r.body!.getReader();
    const decodificar = new TextDecoder();
    let texto = '';
    const leerHasta = async (buscado: string) => {
      while (!texto.includes(buscado)) {
        const { value, done } = await lector.read();
        if (done) break;
        texto += decodificar.decode(value);
      }
    };
    await leerHasta('event: hola');
    const mesa = (await pedir<Salon>('/api/salon', { token })).datos.mesas[0]!;
    await pedir(`/api/mesas/${mesa.id}/abrir`, { token, cuerpo: { comensales: 3 } });
    await leerHasta('"tipo":"salon"');
    expect(texto).toContain('event: cambio\ndata: {"tipo":"salon"}');
    control.abort();
  });

  it('sirve la app del mozo y nada más de la carpeta', async () => {
    const raiz = await fetch(base + '/');
    expect(raiz.headers.get('content-type')).toContain('text/html');
    expect(await raiz.text()).toContain('<title>Mozo</title>');
    expect((await fetch(base + '/assets/app-123.js')).status).toBe(200);
    expect((await fetch(base + '/index.html')).status).toBe(404); // la pantalla de la PC no
    expect((await fetch(base + '/assets/..%2Findex.html')).status).toBe(404); // salirse de assets
    expect((await fetch(base + '/assets/..%2F..%2Fcomandas.db')).status).toBe(404);
  });
});

describe('red local: direcciones, encendido y QR', () => {
  it('reconoce las direcciones privadas del local', () => {
    for (const ip of ['192.168.0.20', '::ffff:192.168.1.5', '10.0.0.7', '172.16.4.1', '172.31.255.1', '127.0.0.1', '::1', 'fe80::1']) {
      expect(esDeLaRedLocal(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '200.45.12.9', '::ffff:181.1.2.3', undefined]) {
      expect(esDeLaRedLocal(ip), String(ip)).toBe(false);
    }
  });

  it('el control prende y apaga según Ajustes, y avisa si el puerto está ocupado', async () => {
    await detenerServidor();
    const red = crearControlRed({ obtenerDb: () => db, carpetaApp, urlDesarrollo: null });
    expect(red.estado()).toMatchObject({ activa: false, funcionando: false });
    guardarRed(db, { activa: true, puerto: 0 });
    const prendido = await red.aplicar();
    expect(prendido).toMatchObject({ activa: true, funcionando: true, error: null });
    expect(prendido.puerto).toBeGreaterThan(0);

    // Otro servidor en el mismo puerto: no arranca y explica por qué.
    const otra = crearControlRed({ obtenerDb: () => db, carpetaApp, urlDesarrollo: null });
    const ocupado = await (async () => {
      const http = await import('node:http');
      const s = http.createServer();
      await new Promise<void>((r) => s.listen(0, '0.0.0.0', () => r()));
      return s;
    })();
    const puertoOcupado = (ocupado.address() as { port: number }).port;
    guardarRed(db, { activa: true, puerto: puertoOcupado });
    const fallo = await otra.aplicar();
    expect(fallo).toMatchObject({ funcionando: false });
    expect(fallo.error).toContain(`El puerto ${puertoOcupado} ya lo está usando otro programa`);
    ocupado.close();

    guardarRed(db, { activa: false, puerto: 3000 });
    expect(await red.aplicar()).toMatchObject({ activa: false, funcionando: false, direcciones: [] });
  });

  it('el QR tiene el tamaño de la versión que entra y los tres cuadrados de las esquinas', () => {
    const qr = generarQr('http://192.168.0.10:3000');
    expect(qr.length).toBe(25); // versión 2: 25 × 25
    const esquina = (f: number, c: number) => qr.slice(f, f + 7).map((fila) => fila.slice(c, c + 7).map((v) => (v ? 1 : 0)).join(''));
    const buscador = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
    expect(esquina(0, 0)).toEqual(buscador);
    expect(esquina(0, 18)).toEqual(buscador);
    expect(esquina(18, 0)).toEqual(buscador);
    expect(generarQr('hola').length).toBe(21); // versión 1
    expect(() => generarQr('x'.repeat(200))).toThrow('demasiado largo');
  });
});
