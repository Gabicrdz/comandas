// Proceso MAIN: arranca la app, abre la base de datos y crea la ventana.
import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { abrirBaseDeDatos, cerrarBaseDeDatos, obtenerDb, rutaBaseDeDatos } from './db/conexion';
import { registrarCanales } from './ipc';
import { copiaAlIniciar } from './copias';
import { crearControlRed } from './red/control';
import { escucharCambios } from './red/avisos';
import { obtenerConfiguracion } from './servicios/configuracion';
import { obtenerPedido } from './servicios/pedidos';
import { htmlComanda } from './impresion/plantillas';
import { imprimirHtml } from './impresion/imprimir';

// Instalador de Windows: crea/borra accesos directos y se cierra.
if (started) app.quit();

// La carpeta de datos queda fija en AppData\Roaming\caja aunque después
// cambiemos el nombre del programa (lección aprendida en el gimnasio).
app.setPath('userData', path.join(app.getPath('appData'), 'comandas'));

// Una sola caja abierta a la vez: dos ventanas escribiendo la misma base
// terminarían mezclando pedidos. Si ya hay una abierta, esta se cierra.
const esLaUnica = app.requestSingleInstanceLock();
if (!esLaUnica) app.quit();

let ventana: BrowserWindow | null = null;

function crearVentana(): void {
  ventana = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f4f1',
    title: 'Comandas',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // La ventana nunca navega a otra página ni abre ventanas nuevas.
  ventana.webContents.on('will-navigate', (evento, url) => {
    if (!MAIN_WINDOW_VITE_DEV_SERVER_URL || !url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) {
      evento.preventDefault();
    }
  });
  // La Caja no tiene links a internet: cualquier intento de abrir una ventana
  // nueva se rechaza (así nadie puede usar la ventana para abrir páginas).
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  ventana.once('ready-to-show', () => {
    ventana?.maximize();
    ventana?.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void ventana.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void ventana.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

app.on('second-instance', () => {
  if (ventana?.isMinimized()) ventana.restore();
  ventana?.focus();
});

// El servidor de los celulares. La app del mozo (mozo.html) se arma junto con la
// ventana: en desarrollo la sirve Vite; instalada, está en la carpeta del renderer.
const red = crearControlRed({
  obtenerDb,
  carpetaApp: MAIN_WINDOW_VITE_DEV_SERVER_URL ? null : path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`),
  urlDesarrollo: MAIN_WINDOW_VITE_DEV_SERVER_URL ?? null,
});

/**
 * Cuando un mozo manda una ronda desde el celular y hay una impresora elegida
 * en Ajustes, la comanda sale sola (sin diálogo). Si no hay impresora, la PC
 * muestra el aviso con el botón "Imprimir comanda".
 */
async function imprimirRondaDelCelular(pedidoId: number, ronda: number): Promise<void> {
  const config = obtenerConfiguracion(obtenerDb());
  if (!config.impresora) return;
  const html = htmlComanda(obtenerPedido(obtenerDb(), pedidoId), config.anchoPapel, ronda);
  if (html) await imprimirHtml(html, config.anchoPapel, config.impresora);
}

app.whenReady().then(() => {
  if (!esLaUnica) return;
  if (app.isPackaged) Menu.setApplicationMenu(null);
  abrirBaseDeDatos(path.join(app.getPath('userData'), 'comandas.db'));
  registrarCanales(() => ({ version: app.getVersion(), baseDeDatos: rutaBaseDeDatos() }), red);
  crearVentana();
  // Todo aviso de cambio también le llega a la ventana de la PC.
  escucharCambios((cambio) => {
    ventana?.webContents.send('cambio', cambio);
    if (cambio.tipo === 'ronda' && cambio.origen === 'celular' && cambio.vaACocina) {
      imprimirRondaDelCelular(cambio.pedidoId, cambio.ronda).catch((e: unknown) => console.error('No se pudo imprimir la comanda:', e));
    }
  });
  void red.aplicar(); // si en Ajustes está prendido, arranca el servidor
  void copiaAlIniciar(); // una copia por día, sin frenar la apertura
  // Muchos locales dejan la caja abierta días enteros: revisamos cada hora
  // si ya cambió el día y hace falta la copia nueva.
  setInterval(() => void copiaAlIniciar(), 60 * 60 * 1000);
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  void red.detener();
  cerrarBaseDeDatos();
});
