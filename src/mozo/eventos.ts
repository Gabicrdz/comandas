// Conexión "en vivo" con la PC (Server-Sent Events) para el celular del mozo y
// la pantalla de cocina. El navegador ya se reconecta solo cuando se corta el
// wifi, pero hay casos que no avisa: el celular se durmió en el bolsillo, el
// router tiró la conexión sin cortarla, la PC se reinició. Por eso acá además:
//  · la PC manda un "latido" cada 25 s; si pasan 70 s sin noticias, reabrimos;
//  · al irse el wifi ("offline") se avisa enseguida, y al volver ("online") o al volver a la app (pantalla encendida)
//    reabrimos enseguida, sin esperar.

export interface OpcionesEventos {
  token: string;
  /** Se conectó (o se reconectó): conviene volver a pedir todo, porque algo pudo cambiar. */
  alConectar: () => void;
  alCambio: (cambio: unknown) => void;
  /** true = hay conexión; false = sin conexión. */
  alEstado: (conectado: boolean) => void;
  /** La conexión se cerró del todo (por ejemplo, el PIN venció): hay que revisar la sesión. */
  alPerderla: () => void;
}

const SIN_NOTICIAS_MS = 70_000;
const REVISAR_CADA_MS = 10_000;
const REINTENTO_MS = 5_000;

/** Abre la conexión y devuelve la función que la cierra. */
export function conectarEventos(o: OpcionesEventos): () => void {
  let fuente: EventSource | null = null;
  let ultimaNoticia = Date.now();
  let reintento: number | undefined;
  let cerrada = false;

  function abrir(): void {
    if (cerrada) return;
    window.clearTimeout(reintento);
    fuente?.close();
    const nueva = new EventSource(`/api/eventos?token=${encodeURIComponent(o.token)}`);
    fuente = nueva;
    ultimaNoticia = Date.now();
    nueva.addEventListener('hola', () => {
      ultimaNoticia = Date.now();
      o.alEstado(true);
      o.alConectar();
    });
    nueva.addEventListener('latido', () => {
      ultimaNoticia = Date.now();
    });
    nueva.addEventListener('cambio', (e) => {
      ultimaNoticia = Date.now();
      try {
        o.alCambio(JSON.parse((e as MessageEvent<string>).data));
      } catch {
        // un aviso mal formado no tira abajo la conexión
      }
    });
    nueva.onerror = () => {
      o.alEstado(false);
      // CLOSED = el navegador se rindió (la PC respondió 401 o se apagó el servidor).
      if (nueva.readyState === EventSource.CLOSED) {
        o.alPerderla();
        reintento = window.setTimeout(abrir, REINTENTO_MS);
      }
    };
  }

  const vigilante = window.setInterval(() => {
    if (Date.now() - ultimaNoticia > SIN_NOTICIAS_MS) {
      o.alEstado(false);
      abrir();
    }
  }, REVISAR_CADA_MS);
  const alIrseElWifi = () => o.alEstado(false); // el navegador sabe que no hay red: lo mostramos ya
  const alVolverElWifi = () => abrir();
  const alVolverALaApp = () => {
    if (document.visibilityState === 'visible' && Date.now() - ultimaNoticia > 35_000) abrir();
  };
  window.addEventListener('offline', alIrseElWifi);
  window.addEventListener('online', alVolverElWifi);
  document.addEventListener('visibilitychange', alVolverALaApp);

  abrir();
  return () => {
    cerrada = true;
    window.clearTimeout(reintento);
    window.clearInterval(vigilante);
    window.removeEventListener('offline', alIrseElWifi);
    window.removeEventListener('online', alVolverElWifi);
    document.removeEventListener('visibilitychange', alVolverALaApp);
    fuente?.close();
  };
}
