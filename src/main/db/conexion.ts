// Abre la base SQLite, aplica las migraciones y entrega el objeto de Drizzle.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as esquema from './esquema';
import { MIGRACIONES } from './migraciones';

/** La base para Drizzle, con `$client` para llegar al better-sqlite3 de abajo. */
export type BaseDeDatos = BetterSQLite3Database<typeof esquema> & { $client: Database.Database };

let sqlite: Database.Database | null = null;
let db: BaseDeDatos | null = null;
let rutaActual = '';

export const VERSION_BASE = MIGRACIONES.length;

export interface OpcionesDeApertura {
  /**
   * Si hay migraciones pendientes en una base que ya tenía datos, se llama ANTES de
   * aplicarlas con la versión actual; si devuelve una ruta, se guarda ahí una copia.
   * Así, si una actualización saliera mal, los datos de antes están a salvo.
   */
  copiaAntesDeActualizar?: (versionActual: number) => string | null;
}

/** Abre (o crea) la base en `ruta`. Con ':memory:' queda en memoria (pruebas). */
export function abrirBaseDeDatos(ruta: string, opciones: OpcionesDeApertura = {}): BaseDeDatos {
  if (db) return db;
  const conexion = new Database(ruta);
  try {
    conexion.pragma('journal_mode = WAL');
    conexion.pragma('foreign_keys = ON');
    aplicarMigraciones(conexion, opciones);
  } catch (error) {
    // Si algo falla al abrir, cerramos el archivo: si no, queda "tomado"
    // y Windows no deja moverlo, borrarlo ni volver a abrirlo bien.
    conexion.close();
    throw error;
  }
  sqlite = conexion;
  rutaActual = ruta;
  db = drizzle(conexion, { schema: esquema });
  return db;
}

function aplicarMigraciones(conexion: Database.Database, opciones: OpcionesDeApertura): void {
  const actual = Number(conexion.pragma('user_version', { simple: true }));
  if (actual > MIGRACIONES.length) {
    throw new Error(
      `La base de datos es de una versión más nueva del sistema (${actual}). Actualizá el programa.`,
    );
  }
  if (actual > 0 && actual < MIGRACIONES.length && opciones.copiaAntesDeActualizar) {
    try {
      const destino = opciones.copiaAntesDeActualizar(actual);
      // VACUUM INTO arma una copia completa y consistente (incluye lo que todavía está en el -wal).
      if (destino) conexion.prepare('VACUUM INTO ?').run(destino);
    } catch (error) {
      // Si no se puede copiar (disco lleno, carpeta bloqueada), no dejamos al local sin sistema.
      console.error('No se pudo hacer la copia previa a la actualización:', error);
    }
  }
  MIGRACIONES.slice(actual).forEach((migracion, i) => {
    const version = actual + i + 1;
    // foreign_keys no se puede cambiar DENTRO de una transacción: se apaga antes.
    if (migracion.reconstruye) conexion.pragma('foreign_keys = OFF');
    try {
      // Cada paso va en una transacción: se aplica entero o no se aplica nada.
      conexion.transaction(() => {
        conexion.exec(migracion.sql);
        if (migracion.reconstruye) {
          // Con las claves apagadas SQLite no revisa nada: lo revisamos nosotros.
          const rotas = conexion.pragma('foreign_key_check') as unknown[];
          if (rotas.length > 0) {
            throw new Error(`La migración ${version} dejaría ${rotas.length} referencias rotas. No se aplicó.`);
          }
        }
        conexion.pragma(`user_version = ${version}`);
      })();
    } finally {
      if (migracion.reconstruye) conexion.pragma('foreign_keys = ON');
    }
    console.log(`Migración ${version} aplicada: ${migracion.nombre}`);
  });
}

export function obtenerDb(): BaseDeDatos {
  if (!db) throw new Error('La base de datos no está abierta.');
  return db;
}

export function rutaBaseDeDatos(): string {
  return rutaActual;
}

export function cerrarBaseDeDatos(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
  rutaActual = '';
}
