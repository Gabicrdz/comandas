// Dividir la cuenta de una mesa entre varias personas. Son funciones puras
// (sin base de datos ni pantalla): la ventana las usa para mostrar cuánto
// paga cada uno y los tests las prueban solas.
//
// Regla de oro: las partes SIEMPRE suman exactamente el total. Cuando no
// se puede repartir justo (por ejemplo $ 10.000 entre 3), lo que sobra se
// reparte de a un peso entre las primeras personas (así nadie paga centavos).

export interface ParteDeCuenta {
  /** 1, 2, 3… */
  persona: number;
  consumoCentavos: number;
  propinaCentavos: number;
  totalCentavos: number;
}

export interface RenglonDivisible {
  id: number;
  cantidad: number;
  totalCentavos: number;
}

/**
 * La unidad en que conviene repartir: pesos enteros si el monto es redondo
 * (nadie quiere pagar $ 9.817,50 en efectivo), centavos si no.
 */
const unidadDe = (montoCentavos: number) => (montoCentavos % 100 === 0 ? 100 : 1);

/** Reparte un monto en `partes` pedazos que suman exacto; los que sobran van de a una unidad a los primeros. */
export function repartirIgual(montoCentavos: number, partes: number): number[] {
  if (!Number.isInteger(partes) || partes < 1) throw new Error('Tiene que haber al menos una persona.');
  const unidad = unidadDe(montoCentavos);
  const total = montoCentavos / unidad;
  const base = Math.floor(total / partes);
  const sobran = total - base * partes;
  return Array.from({ length: partes }, (_, i) => (base + (i < sobran ? 1 : 0)) * unidad);
}

/** Reparte un monto en proporción a `pesos` (el que más consumió, más propina). Suma exacto. */
export function repartirProporcional(montoCentavos: number, pesos: number[]): number[] {
  const suma = pesos.reduce((s, p) => s + p, 0);
  if (suma === 0) return repartirIgual(montoCentavos, pesos.length);
  const unidad = unidadDe(montoCentavos);
  const total = montoCentavos / unidad;
  const crudo = pesos.map((p) => (total * p) / suma);
  const partes = crudo.map(Math.floor);
  let sobran = total - partes.reduce((s, p) => s + p, 0);
  // Lo que falta va a quienes se quedaron con la fracción más grande.
  const orden = crudo.map((c, i) => ({ i, resto: c - Math.floor(c) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of orden) {
    if (sobran <= 0) break;
    partes[i]! += 1;
    sobran -= 1;
  }
  return partes.map((p) => p * unidad);
}

/** Partes iguales: el consumo y la propina se reparten por separado. */
export function dividirIgual(consumoCentavos: number, propinaCentavos: number, personas: number): ParteDeCuenta[] {
  const consumo = repartirIgual(consumoCentavos, personas);
  const propina = repartirIgual(propinaCentavos, personas);
  return consumo.map((c, i) => ({ persona: i + 1, consumoCentavos: c, propinaCentavos: propina[i]!, totalCentavos: c + propina[i]! }));
}

/** Cuántas unidades de cada renglón se lleva cada persona: renglón → [unidades de la persona 1, de la 2…]. */
export type Asignacion = Record<number, number[]>;

export interface DivisionPorItem {
  partes: ParteDeCuenta[];
  /** Unidades que todavía no se le asignaron a nadie (hay que repartirlas antes de cobrar). */
  sinAsignar: { id: number; unidades: number }[];
}

/**
 * Por ítem: cada persona paga lo que consumió. La propina se reparte en
 * proporción a lo consumido. Si falta asignar algo, el consumo asignado no
 * llega al total y `sinAsignar` lo dice.
 */
export function dividirPorItem(renglones: RenglonDivisible[], asignacion: Asignacion, personas: number, propinaCentavos: number): DivisionPorItem {
  if (!Number.isInteger(personas) || personas < 1) throw new Error('Tiene que haber al menos una persona.');
  const consumo = new Array<number>(personas).fill(0);
  const sinAsignar: { id: number; unidades: number }[] = [];
  for (const r of renglones) {
    const reparto = asignacion[r.id] ?? [];
    let asignadas = 0;
    for (let p = 0; p < personas; p++) {
      const u = Math.max(0, Math.floor(reparto[p] ?? 0));
      asignadas += u;
      // El precio de cada unidad es exacto (total = cantidad × precio), pero por las dudas se redondea.
      consumo[p]! += Math.round((r.totalCentavos * u) / r.cantidad);
    }
    if (asignadas < r.cantidad) sinAsignar.push({ id: r.id, unidades: r.cantidad - asignadas });
  }
  const propina = repartirProporcional(propinaCentavos, consumo);
  return {
    partes: consumo.map((c, i) => ({ persona: i + 1, consumoCentavos: c, propinaCentavos: propina[i]!, totalCentavos: c + propina[i]! })),
    sinAsignar,
  };
}

/** Un ítem con más unidades asignadas que las que tiene (la pantalla lo evita, pero se valida). */
export function asignadasDeMas(renglones: RenglonDivisible[], asignacion: Asignacion): number[] {
  return renglones.filter((r) => (asignacion[r.id] ?? []).reduce((s, u) => s + Math.max(0, u), 0) > r.cantidad).map((r) => r.id);
}
