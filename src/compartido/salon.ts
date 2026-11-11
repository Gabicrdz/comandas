// Reglas del plano del salón. Son funciones puras (sin base de datos ni
// pantalla): las usan el main para validar y la ventana para dibujar y
// para saber dónde se puede soltar una mesa mientras la arrastrás.
import { COLUMNAS_SALON, FILAS_SALON } from './esquemas';
import type { FormaMesa } from './tipos';

export interface Lugar {
  x: number;
  y: number;
}

export interface MesaEnPlano extends Lugar {
  id: number;
  forma: FormaMesa;
}

/** Cuántos casilleros ocupa a lo ancho: la mesa larga ocupa dos. */
export const anchoDe = (forma: FormaMesa): number => (forma === 'larga' ? 2 : 1);

/** ¿Entra entera dentro del plano? */
export function entraEnElPlano(forma: FormaMesa, { x, y }: Lugar): boolean {
  return x >= 0 && y >= 0 && y < FILAS_SALON && x + anchoDe(forma) <= COLUMNAS_SALON;
}

/** ¿Dos mesas se pisan? Solo puede pasar en la misma fila. */
export function sePisan(a: { forma: FormaMesa } & Lugar, b: { forma: FormaMesa } & Lugar): boolean {
  return a.y === b.y && a.x < b.x + anchoDe(b.forma) && b.x < a.x + anchoDe(a.forma);
}

/** ¿Se puede poner esta mesa acá? `otras` = las demás mesas de la zona. */
export function lugarDisponible(forma: FormaMesa, lugar: Lugar, otras: MesaEnPlano[], excepto?: number): boolean {
  if (!entraEnElPlano(forma, lugar)) return false;
  return !otras.some((m) => m.id !== excepto && sePisan({ forma, ...lugar }, m));
}

/** El primer casillero libre recorriendo fila por fila (para mesas nuevas). null = la zona está llena. */
export function primerLugarLibre(forma: FormaMesa, otras: MesaEnPlano[], excepto?: number): Lugar | null {
  for (let y = 0; y < FILAS_SALON; y++) {
    for (let x = 0; x < COLUMNAS_SALON; x++) {
      if (lugarDisponible(forma, { x, y }, otras, excepto)) return { x, y };
    }
  }
  return null;
}

/** Minutos entre dos momentos 'AAAA-MM-DD HH:MM:SS' (o desde uno hasta ahora). */
export function minutosDesde(momento: string, ahora: Date = new Date()): number {
  const [fecha, hora = '00:00:00'] = momento.split(' ');
  const [a, m, d] = fecha!.split('-').map(Number);
  const [hh, mm, ss] = hora.split(':').map(Number);
  const inicio = new Date(a!, m! - 1, d!, hh!, mm!, ss ?? 0);
  return Math.max(0, Math.floor((ahora.getTime() - inicio.getTime()) / 60_000));
}

/** "ya", "8 min", "1 h 05", "3 h" */
export function duracionCorta(minutos: number): string {
  if (minutos < 1) return 'ya';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

/** "recién", "hace 8 min", "hace 1 h 05" */
export function hace(minutos: number): string {
  return minutos < 1 ? 'recién' : `hace ${duracionCorta(minutos)}`;
}
