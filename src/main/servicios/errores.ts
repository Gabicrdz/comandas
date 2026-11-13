import { z } from 'zod';

/**
 * Un error "esperado", con un mensaje pensado para la persona que usa la caja
 * (por ejemplo: "Ya hay una categoría con ese nombre"). Los demás errores son
 * fallas del programa: se registran en la consola y la ventana recibe un
 * mensaje genérico.
 */
export class ErrorDeUsuario extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeUsuario';
  }
}

/**
 * Convierte cualquier error en un mensaje para la persona. Lo usan los canales
 * de la ventana (ipc.ts) y el servidor de los celulares (red/servidor.ts).
 */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorDeUsuario) return error.message;
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'Hay datos inválidos.';
  }
  console.error(error);
  return 'Ocurrió un error inesperado. Si se repite, avisale a quien te instaló el sistema.';
}
