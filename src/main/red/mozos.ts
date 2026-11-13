// Sesiones de los celulares. En la PC hay una sola sesión (la de quien está en
// la caja); acá puede haber muchas a la vez, una por mozo. Cuando el mozo pone
// bien su PIN, le damos un TOKEN: un número al azar, largo e imposible de
// adivinar, que el celular manda en cada pedido ("Authorization: Bearer …").
// Es como la pulsera de un recital: ya pagaste, mostrás la pulsera y entrás.
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BaseDeDatos } from '../db/conexion';
import { usuarios } from '../db/esquema';
import type { IngresoMozo, Usuario } from '@compartido/tipos';
import { comprobarPin } from '../servicios/sesion';

/** Si el celular no se usa en 14 horas (un turno largo), tiene que volver a poner el PIN. */
export const DURACION_SESION_MS = 14 * 60 * 60 * 1000;

const sesiones = new Map<string, { usuarioId: number; vence: number }>();

export function ingresarMozo(db: BaseDeDatos, usuarioId: number, pin: string, ahora: number = Date.now()): IngresoMozo {
  const usuario = comprobarPin(db, usuarioId, pin, ahora); // 5 PIN mal → espera, igual que en la PC
  const token = randomBytes(24).toString('hex');
  sesiones.set(token, { usuarioId: usuario.id, vence: ahora + DURACION_SESION_MS });
  return { token, usuario };
}

/**
 * ¿De quién es este token? null si no existe, venció o el usuario fue dado de
 * baja (así, dar de baja a alguien lo saca también de su celular).
 */
export function usuarioDelToken(db: BaseDeDatos, token: string | null, ahora: number = Date.now()): Usuario | null {
  if (!token) return null;
  const sesion = sesiones.get(token);
  if (!sesion || sesion.vence < ahora) {
    sesiones.delete(token);
    return null;
  }
  const u = db
    .select({ id: usuarios.id, nombre: usuarios.nombre, rol: usuarios.rol })
    .from(usuarios)
    .where(and(eq(usuarios.id, sesion.usuarioId), eq(usuarios.activo, true)))
    .get();
  if (!u) {
    sesiones.delete(token);
    return null;
  }
  sesion.vence = ahora + DURACION_SESION_MS; // mientras lo use, no vence
  return u;
}

export function salirMozo(token: string | null): void {
  if (token) sesiones.delete(token);
}

/** Al apagar el servidor (o restaurar una copia), todos los celulares vuelven a pedir PIN. */
export function cerrarSesionesDeMozos(): void {
  sesiones.clear();
}

export function sesionesAbiertas(): number {
  return sesiones.size;
}
