// Prender, apagar y mirar el servidor de los celulares según lo guardado en
// Ajustes. main.ts lo crea (sabe dónde está la app del mozo) y ipc.ts lo usa.
import type { BaseDeDatos } from '../db/conexion';
import type { EstadoRed } from '@compartido/tipos';
import { obtenerConfiguracion } from '../servicios/configuracion';
import { mensajeDeError } from '../servicios/errores';
import { avisarCambio } from './avisos';
import { direccionesLocales } from './redes';
import { celularesConectados, detenerServidor, iniciarServidor, servidorFuncionando } from './servidor';

export interface ControlRed {
  estado(): EstadoRed;
  /** Lee Ajustes y deja el servidor prendido o apagado según corresponda. */
  aplicar(): Promise<EstadoRed>;
  detener(): Promise<void>;
  /** Abre la pantalla de cocina en una ventana de esta PC (la pone main.ts). */
  abrirCocina?(): void;
}

export function crearControlRed(opciones: {
  obtenerDb: () => BaseDeDatos;
  carpetaApp: string | null;
  urlDesarrollo: string | null;
}): ControlRed {
  let error: string | null = null;
  let puertoReal: number | null = null;

  function estado(): EstadoRed {
    const config = obtenerConfiguracion(opciones.obtenerDb());
    const funcionando = servidorFuncionando();
    const puerto = funcionando && puertoReal ? puertoReal : config.redPuerto;
    return {
      activa: config.redActiva,
      puerto,
      funcionando,
      direcciones: funcionando ? direccionesLocales().map((ip) => `http://${ip}:${puerto}`) : [],
      error,
      conectados: celularesConectados(),
    };
  }

  return {
    estado,
    async aplicar() {
      const config = obtenerConfiguracion(opciones.obtenerDb());
      error = null;
      if (!config.redActiva) {
        await detenerServidor();
        puertoReal = null;
      } else {
        try {
          puertoReal = await iniciarServidor({ ...opciones, puerto: config.redPuerto });
        } catch (e) {
          error = mensajeDeError(e);
          puertoReal = null;
          await detenerServidor();
        }
      }
      avisarCambio({ tipo: 'salon' });
      return estado();
    },
    detener: () => detenerServidor(),
  };
}

/** Para cuando no hay servidor (pruebas de la ventana en el contenedor). */
export const sinRed: ControlRed = {
  estado: () => ({ activa: false, puerto: 3000, funcionando: false, direcciones: [], error: null, conectados: 0 }),
  aplicar: async () => sinRed.estado(),
  detener: async () => undefined,
};
