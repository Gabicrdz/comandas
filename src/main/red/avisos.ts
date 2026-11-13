// "Avisos" de cambios: cada vez que algo cambia en el salón o en el menú, el
// main lo anuncia acá. Escuchan la ventana de la PC (por IPC) y los celulares
// (por Server-Sent Events, ver servidor.ts). Así todos ven lo nuevo al instante,
// sin tener que estar preguntando cada pocos segundos.
//
// EventEmitter es el "megáfono" de Node: uno emite, todos los que se
// suscribieron con .on() reciben el mismo mensaje.
import { EventEmitter } from 'node:events';
import type { Cambio } from '@compartido/tipos';

const megafono = new EventEmitter();
// Cada celular conectado es un oyente: subimos el límite que trae Node (10)
// para que no avise de una "pérdida de memoria" que no es tal.
megafono.setMaxListeners(200);

export function avisarCambio(cambio: Cambio): void {
  megafono.emit('cambio', cambio);
}

/** Se suscribe a los cambios. Devuelve la función para dejar de escuchar. */
export function escucharCambios(fn: (cambio: Cambio) => void): () => void {
  megafono.on('cambio', fn);
  return () => megafono.off('cambio', fn);
}
