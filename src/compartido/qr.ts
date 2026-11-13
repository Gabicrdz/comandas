// Generador de códigos QR, escrito a mano (sin librerías) para la dirección
// que escanean los mozos. Implementa lo justo del estándar QR (ISO 18004):
//   - modo "byte" (cualquier texto UTF-8),
//   - nivel de corrección M (se puede leer aunque falte ~15 % del dibujo),
//   - versiones 1 a 6 (hasta 106 letras: de sobra para "http://192.168.0.10:3000").
//
// Los pasos son siempre los mismos:
//   1. pasar el texto a bits (modo + largo + datos + relleno);
//   2. calcular los bytes de corrección de errores (Reed-Solomon);
//   3. dibujar los patrones fijos (los tres cuadrados de las esquinas, etc.);
//   4. ubicar los bits en zigzag y aplicar la "máscara" que deja el dibujo más parejo.
// Devuelve una matriz de true (negro) / false (blanco).

/** Por versión: [bytes de corrección por bloque, cantidad de bloques, bytes de datos por bloque] (nivel M). */
const BLOQUES_M: Record<number, [number, number, number]> = {
  1: [10, 1, 16],
  2: [16, 1, 28],
  3: [26, 1, 44],
  4: [18, 2, 32],
  5: [24, 2, 43],
  6: [16, 4, 27],
};
/** Dónde van los patrones de alineación (los cuadraditos chicos) en cada versión. */
const ALINEACION: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

// ── Aritmética en GF(256): la "matemática" de Reed-Solomon ──
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const multiplicar = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** Los bytes de corrección de un bloque de datos (resto de dividir por el polinomio generador). */
function correccion(datos: number[], cantidad: number): number[] {
  let generador = [1];
  for (let i = 0; i < cantidad; i++) {
    const siguiente = new Array<number>(generador.length + 1).fill(0);
    generador.forEach((g, j) => {
      siguiente[j] = siguiente[j]! ^ g;
      siguiente[j + 1] = siguiente[j + 1]! ^ multiplicar(g, EXP[i]!);
    });
    generador = siguiente;
  }
  const resto = [...datos, ...new Array<number>(cantidad).fill(0)];
  for (let i = 0; i < datos.length; i++) {
    const factor = resto[i]!;
    if (factor === 0) continue;
    generador.forEach((g, j) => {
      resto[i + j] = resto[i + j]! ^ multiplicar(g, factor);
    });
  }
  return resto.slice(datos.length);
}

export function generarQr(texto: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(texto)];
  const version = [1, 2, 3, 4, 5, 6].find((v) => {
    const [, bloques, porBloque] = BLOQUES_M[v]!;
    return 4 + 8 + bytes.length * 8 <= bloques * porBloque * 8;
  });
  if (!version) throw new Error('El texto es demasiado largo para el código QR.');
  const [cantidadCorreccion, bloques, porBloque] = BLOQUES_M[version]!;
  const capacidad = bloques * porBloque;

  // 1) Bits: modo byte (0100), largo en 8 bits, los datos, fin (0000) y relleno.
  const bits: number[] = [];
  const poner = (valor: number, largo: number) => {
    for (let i = largo - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(bytes.length, 8);
  bytes.forEach((b) => poner(b, 8));
  poner(0, Math.min(4, capacidad * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const datos: number[] = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let relleno = 0xec; datos.length < capacidad; relleno ^= 0xec ^ 0x11) datos.push(relleno);

  // 2) Corrección por bloque y entrelazado (primero un byte de cada bloque, y así).
  const deCadaBloque = Array.from({ length: bloques }, (_, b) => datos.slice(b * porBloque, (b + 1) * porBloque));
  const correcciones = deCadaBloque.map((d) => correccion(d, cantidadCorreccion));
  const final: number[] = [];
  for (let i = 0; i < porBloque; i++) deCadaBloque.forEach((d) => final.push(d[i]!));
  for (let i = 0; i < cantidadCorreccion; i++) correcciones.forEach((c) => final.push(c[i]!));

  // 3) Patrones fijos.
  const lado = 17 + version * 4;
  const matriz: (boolean | null)[][] = Array.from({ length: lado }, () => new Array<boolean | null>(lado).fill(null));
  const reservado: boolean[][] = Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false));
  const fijar = (f: number, c: number, negro: boolean) => {
    if (f < 0 || c < 0 || f >= lado || c >= lado) return;
    matriz[f]![c] = negro;
    reservado[f]![c] = true;
  };
  const buscador = (f0: number, c0: number) => {
    for (let f = -1; f <= 7; f++) {
      for (let c = -1; c <= 7; c++) {
        const borde = f === 0 || f === 6 || c === 0 || c === 6;
        const centro = f >= 2 && f <= 4 && c >= 2 && c <= 4;
        fijar(f0 + f, c0 + c, f >= 0 && f <= 6 && c >= 0 && c <= 6 && (borde || centro));
      }
    }
  };
  buscador(0, 0);
  buscador(0, lado - 7);
  buscador(lado - 7, 0);
  for (let i = 8; i < lado - 8; i++) {
    fijar(6, i, i % 2 === 0);
    fijar(i, 6, i % 2 === 0);
  }
  const centros = ALINEACION[version]!;
  for (const f of centros) {
    for (const c of centros) {
      if ((f === 6 && c === 6) || (f === 6 && c === lado - 7) || (f === lado - 7 && c === 6)) continue;
      for (let df = -2; df <= 2; df++) {
        for (let dc = -2; dc <= 2; dc++) fijar(f + df, c + dc, Math.max(Math.abs(df), Math.abs(dc)) !== 1);
      }
    }
  }
  fijar(lado - 8, 8, true); // el módulo negro fijo
  // Lugares del formato (se escriben al final, pero se reservan ahora).
  for (let i = 0; i < 9; i++) {
    if (!reservado[8]![i]) fijar(8, i, false);
    if (!reservado[i]![8]) fijar(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    fijar(8, lado - 1 - i, false);
    fijar(lado - 1 - i, 8, false);
  }
  fijar(lado - 8, 8, true);

  // 4) Datos en zigzag: de a dos columnas, de derecha a izquierda, subiendo y bajando.
  const bitsFinales = final.flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >>> (7 - i)) & 1));
  let indice = 0;
  let subiendo = true;
  for (let derecha = lado - 1; derecha > 0; derecha -= 2) {
    if (derecha === 6) derecha = 5; // la columna 6 es del patrón de sincronización
    for (let paso = 0; paso < lado; paso++) {
      const f = subiendo ? lado - 1 - paso : paso;
      for (const c of [derecha, derecha - 1]) {
        if (reservado[f]![c]) continue;
        matriz[f]![c] = (bitsFinales[indice++] ?? 0) === 1;
      }
    }
    subiendo = !subiendo;
  }

  // La máscara invierte algunos módulos para que no queden manchas grandes.
  const mascaras: ((f: number, c: number) => boolean)[] = [
    (f, c) => (f + c) % 2 === 0,
    (f) => f % 2 === 0,
    (_f, c) => c % 3 === 0,
    (f, c) => (f + c) % 3 === 0,
    (f, c) => (Math.floor(f / 2) + Math.floor(c / 3)) % 2 === 0,
    (f, c) => ((f * c) % 2) + ((f * c) % 3) === 0,
    (f, c) => (((f * c) % 2) + ((f * c) % 3)) % 2 === 0,
    (f, c) => (((f + c) % 2) + ((f * c) % 3)) % 2 === 0,
  ];

  function conMascara(m: number): boolean[][] {
    const resultado = matriz.map((fila, f) => fila.map((v, c) => (reservado[f]![c] ? !!v : !!v !== mascaras[m]!(f, c))));
    // Formato: nivel M (00) + número de máscara, con su código BCH y la máscara fija 0x5412.
    const datosFormato = (0b00 << 3) | m;
    let bch = datosFormato << 10;
    for (let i = 14; i >= 10; i--) if ((bch >>> i) & 1) bch ^= 0x537 << (i - 10);
    const formato = ((datosFormato << 10) | bch) ^ 0x5412;
    const bit = (i: number) => ((formato >>> i) & 1) === 1;
    // Copia 1, alrededor del buscador de arriba a la izquierda (saltea la línea de sincronización).
    for (let i = 0; i <= 5; i++) resultado[i]![8] = bit(i);
    resultado[7]![8] = bit(6);
    resultado[8]![8] = bit(7);
    resultado[8]![7] = bit(8);
    for (let i = 9; i < 15; i++) resultado[8]![14 - i] = bit(i);
    // Copia 2, repartida entre los otros dos buscadores.
    for (let i = 0; i < 8; i++) resultado[8]![lado - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) resultado[lado - 15 + i]![8] = bit(i);
    resultado[lado - 8]![8] = true;
    return resultado;
  }

  // Elegimos la máscara con menos "penalidad" (reglas del estándar).
  function penalidad(m: boolean[][]): number {
    let p = 0;
    for (let f = 0; f < lado; f++) {
      for (const linea of [m[f]!, m.map((fila) => fila[f]!)]) {
        let racha = 1;
        for (let i = 1; i <= lado; i++) {
          if (i < lado && linea[i] === linea[i - 1]) racha++;
          else {
            if (racha >= 5) p += racha - 2;
            racha = 1;
          }
        }
        for (let i = 0; i + 10 < lado; i++) {
          const trozo = linea.slice(i, i + 11).map((v) => (v ? 1 : 0)).join('');
          if (trozo === '10111010000' || trozo === '00001011101') p += 40;
        }
      }
    }
    for (let f = 0; f < lado - 1; f++) {
      for (let c = 0; c < lado - 1; c++) {
        const v = m[f]![c];
        if (v === m[f]![c + 1] && v === m[f + 1]![c] && v === m[f + 1]![c + 1]) p += 3;
      }
    }
    const negros = m.flat().filter(Boolean).length;
    p += Math.floor(Math.abs((negros * 100) / (lado * lado) - 50) / 5) * 10;
    return p;
  }

  let mejor = conMascara(0);
  let menor = penalidad(mejor);
  for (let m = 1; m < 8; m++) {
    const candidata = conMascara(m);
    const p = penalidad(candidata);
    if (p < menor) {
      mejor = candidata;
      menor = p;
    }
  }
  return mejor;
}
