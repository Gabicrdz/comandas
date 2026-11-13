// Direcciones de la red del local. Cada aparato conectado al mismo wifi (o
// cable) tiene una dirección IP "privada", por ejemplo 192.168.0.10. Esas
// direcciones no existen en internet: solo se ven dentro del local.
import os from 'node:os';

/** ¿Es una dirección privada (de una red de casa u oficina) o de esta misma PC? */
export function esDeLaRedLocal(direccion: string | undefined): boolean {
  if (!direccion) return false;
  // Node a veces muestra las IPv4 "disfrazadas" de IPv6: ::ffff:192.168.0.20
  const ip = direccion.replace(/^::ffff:/i, '');
  if (ip === '::1' || ip.startsWith('127.')) return true; // esta misma PC
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  const segundo = /^172\.(\d+)\./.exec(ip);
  if (segundo) {
    const n = Number(segundo[1]);
    return n >= 16 && n <= 31;
  }
  // IPv6 de la red local: fe80::… (enlace) y fc00::/7 (privadas)
  return /^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip);
}

/** Las direcciones IPv4 privadas de esta PC (puede tener más de una: wifi y cable). */
export function direccionesLocales(): string[] {
  const resultado: string[] = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const d of lista ?? []) {
      if (d.family === 'IPv4' && !d.internal && esDeLaRedLocal(d.address) && !d.address.startsWith('169.254.')) {
        resultado.push(d.address);
      }
    }
  }
  // Las 192.168.x.x primero: es la red típica de un router de local o de casa.
  return resultado.sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')));
}
