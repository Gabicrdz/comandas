// El SERVIDOR de la red local: la PC de la caja atiende a los celulares.
//
// Hasta ahora la ventana le hablaba al main por IPC (un "teléfono interno"
// que solo existe dentro de la PC). Los celulares están en otro aparato, así
// que hablan por la red con HTTP, como cualquier página web:
//
//   celular ──GET /api/salon──────────────▶ PC   (pide datos)
//   celular ──POST /api/cuentas/7/rondas──▶ PC   (manda una ronda)
//   celular ◀──"cambio: salón"──────────── PC   (la PC avisa sola: SSE)
//
// SSE (Server-Sent Events) = una respuesta HTTP que NO termina: la PC la deja
// abierta y va escribiendo un renglón por cada novedad. El navegador la lee con
// `new EventSource(...)` y, si se corta el wifi, se vuelve a conectar solo.
// Es más simple que WebSocket y alcanza: los celulares MANDAN con fetch y
// RECIBEN avisos por SSE.
//
// Usa el módulo `http` que ya trae Node: no hace falta instalar nada.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { BaseDeDatos } from '../db/conexion';
import { usuarios } from '../db/esquema';
import {
  esquemaAbrirMesaCelular,
  esquemaEstadoComanda,
  esquemaIngresoMozo,
  esquemaPedirCuenta,
  esquemaPinCocina,
  esquemaRonda,
  esquemaSectorPantalla,
} from '@compartido/esquemas';
import { ErrorDeUsuario, mensajeDeError } from '../servicios/errores';
import { obtenerMenu } from '../servicios/menu';
import { obtenerPedido } from '../servicios/pedidos';
import * as salon from '../servicios/salon';
import { obtenerConfiguracion } from '../servicios/configuracion';
import { avisarCambio, escucharCambios } from './avisos';
import { esDeLaRedLocal } from './redes';
import { ingresarMozo, salirMozo, usuarioDelToken, cerrarSesionesDeMozos, esTokenDeCocina } from './mozos';
import { ingresarCocina } from './cocina';
import { cambiarEstadoComanda, listarComandas, type ComandaCambiada } from '../servicios/comandas';

export interface OpcionesServidor {
  puerto: number;
  obtenerDb: () => BaseDeDatos;
  /** Carpeta con mozo.html y assets/ (la app instalada). */
  carpetaApp: string | null;
  /** En desarrollo (npm start), la app del mozo la sirve Vite: la pedimos ahí. */
  urlDesarrollo: string | null;
}

/** Error con código HTTP (401 = falta el PIN, 404 = no existe, etc.). */
class ErrorHttp extends Error {
  constructor(
    public estado: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

let servidor: http.Server | null = null;
const conectados = new Set<http.ServerResponse>();
let dejarDeEscuchar: (() => void) | null = null;
let latido: NodeJS.Timeout | null = null;

export function servidorFuncionando(): boolean {
  return servidor !== null;
}

export function celularesConectados(): number {
  return conectados.size;
}

/** Arranca el servidor. Devuelve el puerto en el que quedó escuchando. */
export async function iniciarServidor(opciones: OpcionesServidor): Promise<number> {
  await detenerServidor();
  const nuevo = http.createServer((req, res) => {
    void atender(req, res, opciones);
  });
  await new Promise<void>((resolver, rechazar) => {
    nuevo.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        rechazar(new ErrorDeUsuario(`El puerto ${opciones.puerto} ya lo está usando otro programa. Probá con otro (por ejemplo 3001).`));
      } else if (error.code === 'EACCES') {
        rechazar(new ErrorDeUsuario(`Windows no deja usar el puerto ${opciones.puerto}. Probá con otro (por ejemplo 3001).`));
      } else rechazar(error);
    });
    // '0.0.0.0' = escuchar en TODAS las conexiones de la PC (wifi y cable), no
    // solo en "localhost". Es lo que permite que entren los celulares.
    nuevo.listen(opciones.puerto, '0.0.0.0', () => resolver());
  });
  servidor = nuevo;

  // Cada aviso del main se reenvía a todos los celulares conectados.
  dejarDeEscuchar = escucharCambios((cambio) => {
    for (const res of conectados) enviarEvento(res, 'cambio', cambio);
  });
  // Un comentario cada 25 s mantiene viva la conexión (algunos routers cortan
  // las conexiones que no mandan nada por un rato).
  latido = setInterval(() => {
    // Además del comentario, un evento con nombre: el navegador no deja ver los
    // comentarios, y con este el celular sabe que la conexión sigue viva.
    for (const res of conectados) enviarEvento(res, 'latido', {});
  }, 25_000);

  const direccion = nuevo.address();
  return typeof direccion === 'object' && direccion ? direccion.port : opciones.puerto;
}

export async function detenerServidor(): Promise<void> {
  dejarDeEscuchar?.();
  dejarDeEscuchar = null;
  if (latido) clearInterval(latido);
  latido = null;
  for (const res of conectados) res.end();
  conectados.clear();
  cerrarSesionesDeMozos();
  const anterior = servidor;
  servidor = null;
  if (anterior) {
    anterior.closeAllConnections();
    await new Promise<void>((resolver) => anterior.close(() => resolver()));
  }
}

// ───────────────────────── Atender un pedido HTTP ─────────────────────────

async function atender(req: http.IncomingMessage, res: http.ServerResponse, opciones: OpcionesServidor): Promise<void> {
  try {
    // Solo aparatos del local. Si alguien abriera el puerto en el router hacia
    // internet, igual lo rechazamos.
    if (!esDeLaRedLocal(req.socket.remoteAddress)) throw new ErrorHttp(403, 'Solo se puede entrar desde la red del local.');
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname.startsWith('/api/')) {
      await api(req, res, url, opciones.obtenerDb());
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErrorHttp(405, 'Método no permitido.');
    await archivos(url.pathname, res, opciones);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const estado = error instanceof ErrorHttp ? error.estado : error instanceof ErrorDeUsuario || error instanceof z.ZodError ? 400 : 500;
    responderJson(res, estado, { error: error instanceof ErrorHttp ? error.message : mensajeDeError(error) });
  }
}

function responderJson(res: http.ServerResponse, estado: number, datos: unknown): void {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(cuerpo);
}

/** Lee el cuerpo JSON de un POST (hasta 100 KB: una ronda ocupa mucho menos). */
async function leerJson(req: http.IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = [];
  let largo = 0;
  for await (const parte of req) {
    largo += (parte as Buffer).length;
    if (largo > 100_000) throw new ErrorHttp(413, 'El pedido es demasiado grande.');
    partes.push(parte as Buffer);
  }
  if (largo === 0) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErrorHttp(400, 'Datos inválidos.');
  }
}

function tokenDe(req: http.IncomingMessage, url: URL): string | null {
  const encabezado = req.headers.authorization;
  if (encabezado?.startsWith('Bearer ')) return encabezado.slice(7);
  // EventSource no puede mandar encabezados: para /api/eventos va en la dirección.
  return url.searchParams.get('token');
}

function enviarEvento(res: http.ServerResponse, evento: string, datos: unknown): void {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);
}

const idDe = (texto: string | undefined) => {
  const n = Number(texto);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorHttp(404, 'No existe.');
  return n;
};

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL, db: BaseDeDatos): Promise<void> {
  const metodo = req.method ?? 'GET';
  const ruta = url.pathname;

  // ── Sin PIN: lo justo para mostrar la pantalla de ingreso ──
  if (metodo === 'GET' && ruta === '/api/hola') {
    responderJson(res, 200, { local: obtenerConfiguracion(db).nombreLocal });
    return;
  }
  if (metodo === 'GET' && ruta === '/api/equipo') {
    // Nombres y roles, nunca el PIN (igual que la pantalla de ingreso de la PC).
    const equipo = db
      .select({ id: usuarios.id, nombre: usuarios.nombre, rol: usuarios.rol })
      .from(usuarios)
      .where(eq(usuarios.activo, true))
      .orderBy(asc(usuarios.nombre))
      .all();
    responderJson(res, 200, [...equipo.filter((u) => u.rol === 'mozo'), ...equipo.filter((u) => u.rol !== 'mozo')]);
    return;
  }
  if (metodo === 'POST' && ruta === '/api/ingresar') {
    const datos = esquemaIngresoMozo.parse(await leerJson(req));
    try {
      responderJson(res, 200, ingresarMozo(db, datos.usuarioId, datos.pin));
    } catch (error) {
      throw new ErrorHttp(401, mensajeDeError(error));
    }
    return;
  }

  if (metodo === 'POST' && ruta === '/api/cocina/ingresar') {
    const { pin } = esquemaPinCocina.parse(await leerJson(req));
    try {
      responderJson(res, 200, { token: ingresarCocina(db, pin) });
    } catch (error) {
      throw new ErrorHttp(401, mensajeDeError(error));
    }
    return;
  }

  const token = tokenDe(req, url);

  // ── Pantalla de cocina / barra (token de cocina) ──
  if (ruta.startsWith('/api/cocina/') || (ruta === '/api/eventos' && esTokenDeCocina(token))) {
    if (!esTokenDeCocina(token)) throw new ErrorHttp(401, 'La pantalla se desconectó. Volvé a poner el PIN de cocina.');
    if (metodo === 'GET' && ruta === '/api/eventos') {
      abrirEventos(req, res);
      return;
    }
    if (metodo === 'GET' && ruta === '/api/cocina/comandas') {
      const sector = esquemaSectorPantalla.parse(url.searchParams.get('sector'));
      return responderJson(res, 200, listarComandas(db, sector));
    }
    const estado = /^\/api\/cocina\/comandas\/(\d+)\/estado$/.exec(ruta);
    if (metodo === 'POST' && estado) {
      const datos = esquemaEstadoComanda.parse(await leerJson(req));
      const cambio = cambiarEstadoComanda(db, idDe(estado[1]), datos.estado);
      avisarComanda(cambio);
      return responderJson(res, 200, null);
    }
    throw new ErrorHttp(404, 'No existe.');
  }

  // ── Celular de un mozo (token de mozo) ──
  const yo = usuarioDelToken(db, token);
  if (!yo) throw new ErrorHttp(401, 'Tu sesión se cerró. Volvé a poner tu PIN.');

  if (metodo === 'GET' && ruta === '/api/eventos') {
    abrirEventos(req, res);
    return;
  }

  // El mozo llevó a la mesa lo que estaba listo.
  const entregada = /^\/api\/comandas\/(\d+)\/entregada$/.exec(ruta);
  if (metodo === 'POST' && entregada) {
    avisarComanda(cambiarEstadoComanda(db, idDe(entregada[1]), 'entregada'));
    return responderJson(res, 200, null);
  }
  if (metodo === 'POST' && ruta === '/api/salir') {
    salirMozo(token);
    responderJson(res, 200, null);
    return;
  }
  if (metodo === 'GET' && ruta === '/api/yo') return responderJson(res, 200, yo);
  if (metodo === 'GET' && ruta === '/api/salon') return responderJson(res, 200, salon.obtenerSalon(db));
  if (metodo === 'GET' && ruta === '/api/menu') return responderJson(res, 200, obtenerMenu(db));

  const abrir = /^\/api\/mesas\/(\d+)\/abrir$/.exec(ruta);
  if (metodo === 'POST' && abrir) {
    const { comensales } = esquemaAbrirMesaCelular.parse(await leerJson(req));
    const pedidoId = salon.abrirMesa(db, { mesaId: idDe(abrir[1]), comensales, mozoId: yo.id }, yo);
    avisarCambio({ tipo: 'salon' });
    return responderJson(res, 200, pedidoId);
  }

  const cuenta = /^\/api\/cuentas\/(\d+)(\/rondas|\/cuenta)?$/.exec(ruta);
  if (cuenta) {
    const pedidoId = idDe(cuenta[1]);
    if (metodo === 'GET' && !cuenta[2]) {
      const pedido = obtenerPedido(db, pedidoId);
      if (pedido.mesaId === null) throw new ErrorHttp(404, 'Esa cuenta no existe.');
      return responderJson(res, 200, pedido);
    }
    if (metodo === 'POST' && cuenta[2] === '/rondas') {
      const datos = esquemaRonda.parse(await leerJson(req));
      const r = salon.agregarRonda(db, pedidoId, datos, yo);
      // Un reintento (la respuesta anterior se perdió) no vuelve a sonar ni a imprimir.
      if (!r.repetida) {
        const mesa = obtenerPedido(db, pedidoId).mesa;
        avisarCambio({ tipo: 'ronda', origen: 'celular', pedidoId, ronda: r.ronda, mesa, quien: yo.nombre, vaACocina: r.vaACocina });
      }
      return responderJson(res, 200, r);
    }
    if (metodo === 'POST' && cuenta[2] === '/cuenta') {
      const { pedida } = esquemaPedirCuenta.parse(await leerJson(req));
      salon.pedirCuenta(db, pedidoId, pedida);
      const mesa = obtenerPedido(db, pedidoId).mesa;
      avisarCambio(pedida ? { tipo: 'cuenta', origen: 'celular', mesa, quien: yo.nombre } : { tipo: 'salon' });
      return responderJson(res, 200, null);
    }
  }
  throw new ErrorHttp(404, 'No existe.');
}

function avisarComanda(c: ComandaCambiada): void {
  avisarCambio({ tipo: 'comanda', ...c });
}

/** Deja abierta la respuesta para ir mandando avisos (SSE). */
function abrirEventos(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
  // "retry" le dice al navegador cuánto esperar para reconectarse si se corta.
  res.write('retry: 3000\n\n');
  enviarEvento(res, 'hola', { hora: new Date().toISOString() });
  conectados.add(res);
  avisarCambio({ tipo: 'salon' }); // la PC actualiza la cantidad de celulares conectados
  req.on('close', () => {
    conectados.delete(res);
    if (servidor) avisarCambio({ tipo: 'salon' });
  });
}

// ───────────────────────── La app del mozo (archivos) ─────────────────────────

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

async function archivos(ruta: string, res: http.ServerResponse, opciones: OpcionesServidor): Promise<void> {
  // La raíz es la app del mozo y /cocina, la pantalla de cocina. La pantalla de
  // la PC (index.html) NO se sirve.
  const pedido = ruta === '/' || ruta === '/mozo' ? '/mozo.html' : ruta === '/cocina' ? '/cocina.html' : ruta;

  if (opciones.urlDesarrollo) {
    // npm start: Vite arma la app al vuelo; se la pedimos y la reenviamos.
    const respuesta = await fetch(new URL(pedido, opciones.urlDesarrollo));
    const cuerpo = Buffer.from(await respuesta.arrayBuffer());
    res.writeHead(respuesta.status, { 'Content-Type': respuesta.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
    return;
  }

  if (!opciones.carpetaApp) throw new ErrorHttp(404, 'No existe.');
  // Solo mozo.html, cocina.html y lo que está DENTRO de assets/. Se arma la ruta final y se
  // revisa que siga adentro: así "/assets/..%2Findex.html" (que decodificado es
  // "/assets/../index.html") no sirve para salirse de la carpeta.
  const carpeta = path.resolve(opciones.carpetaApp);
  const assets = path.join(carpeta, 'assets');
  let archivo: string;
  if (pedido === '/mozo.html' || pedido === '/cocina.html') archivo = path.join(carpeta, pedido.slice(1));
  else if (pedido.startsWith('/assets/')) {
    archivo = path.resolve(carpeta, '.' + decodeURIComponent(pedido));
    if (!archivo.startsWith(assets + path.sep)) throw new ErrorHttp(404, 'No existe.');
  } else throw new ErrorHttp(404, 'No existe.');
  let contenido: Buffer;
  try {
    contenido = await readFile(archivo);
  } catch {
    throw new ErrorHttp(404, 'No existe.');
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(archivo)] ?? 'application/octet-stream',
    // Los archivos de assets/ llevan un código en el nombre: se pueden guardar.
    'Cache-Control': pedido.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(contenido);
}
