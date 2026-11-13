// La pantalla de cocina (o de barra) no es una persona: es un aparato pegado
// en la pared. Por eso no entra con un usuario sino con un PIN propio de la
// cocina, que el dueño elige en Ajustes. Se guarda como hash + sal, igual que
// los PIN de los usuarios.
import type { BaseDeDatos } from '../db/conexion';
import { guardarPinCocina, pinCocinaGuardado } from '../servicios/configuracion';
import { ErrorDeUsuario } from '../servicios/errores';
import { hashDePin, pinCorrecto } from '../servicios/usuarios';
import { crearSesion } from './mozos';

const MAXIMO_INTENTOS = 5;
const ESPERA_MS = 30_000;
let fallos = { cantidad: 0, hasta: 0 };

export function cambiarPinCocina(db: BaseDeDatos, pin: string): void {
  const { hash, sal } = hashDePin(pin);
  guardarPinCocina(db, hash, sal);
}

/** Devuelve el token de la pantalla. 5 errores seguidos → 30 segundos de espera. */
export function ingresarCocina(db: BaseDeDatos, pin: string, ahora: number = Date.now()): string {
  const guardado = pinCocinaGuardado(db);
  if (!guardado) throw new ErrorDeUsuario('Todavía no hay PIN de cocina. El dueño lo elige en la PC: Ajustes → Pantalla de cocina.');
  if (fallos.hasta > ahora) throw new ErrorDeUsuario(`Demasiados intentos. Esperá ${Math.ceil((fallos.hasta - ahora) / 1000)} segundos.`);
  if (!pinCorrecto(pin, guardado.hash, guardado.sal)) {
    const cantidad = fallos.hasta !== 0 ? 1 : fallos.cantidad + 1;
    fallos = { cantidad, hasta: cantidad >= MAXIMO_INTENTOS ? ahora + ESPERA_MS : 0 };
    throw new ErrorDeUsuario(cantidad >= MAXIMO_INTENTOS ? 'PIN incorrecto. Esperá 30 segundos para volver a probar.' : 'PIN incorrecto.');
  }
  fallos = { cantidad: 0, hasta: 0 };
  return crearSesion('cocina', null, ahora);
}

/** Para las pruebas. */
export function reiniciarIntentosCocina(): void {
  fallos = { cantidad: 0, hasta: 0 };
}
