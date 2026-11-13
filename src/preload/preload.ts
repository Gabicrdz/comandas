// PRELOAD: el único puente entre la ventana y el main. Expone `window.caja`
// con funciones concretas; la ventana nunca tiene acceso a ipcRenderer.
import { contextBridge, ipcRenderer } from 'electron';
import { CANALES, type ApiCaja } from '@compartido/api';

const pedir = (canal: string, ...args: unknown[]) => ipcRenderer.invoke(canal, ...args);

const api: ApiCaja = {
  sesion: {
    actual: () => pedir(CANALES.sesionActual),
    iniciar: (usuarioId, pin) => pedir(CANALES.sesionIniciar, usuarioId, pin),
    cerrar: () => pedir(CANALES.sesionCerrar),
  },
  usuarios: {
    paraIngresar: () => pedir(CANALES.usuariosParaIngresar),
    crearPrimero: (nombre, pin) => pedir(CANALES.usuariosCrearPrimero, nombre, pin),
    listar: () => pedir(CANALES.usuariosListar),
    guardar: (datos) => pedir(CANALES.usuariosGuardar, datos),
    darDeBaja: (id) => pedir(CANALES.usuariosBaja, id),
  },
  caja: {
    actual: () => pedir(CANALES.cajaActual),
    abrir: (fondoCentavos) => pedir(CANALES.cajaAbrir, { fondoCentavos }),
    movimiento: (datos) => pedir(CANALES.cajaMovimiento, datos),
    cerrar: (datos) => pedir(CANALES.cajaCerrar, datos),
    historial: () => pedir(CANALES.cajaHistorial),
    resumen: (id) => pedir(CANALES.cajaResumen, id),
  },
  menu: {
    obtener: () => pedir(CANALES.menuObtener),
    cargarEjemplo: () => pedir(CANALES.menuCargarEjemplo),
  },
  categorias: {
    crear: (datos) => pedir(CANALES.categoriaCrear, datos),
    renombrar: (id, datos) => pedir(CANALES.categoriaRenombrar, id, datos),
    mover: (id, direccion) => pedir(CANALES.categoriaMover, id, direccion),
    cambiarEstado: (id, activa) => pedir(CANALES.categoriaEstado, id, activa),
  },
  productos: {
    guardar: (datos) => pedir(CANALES.productoGuardar, datos),
    cambiarDisponible: (id, disponible) => pedir(CANALES.productoDisponible, id, disponible),
    duplicar: (id) => pedir(CANALES.productoDuplicar, id),
    darDeBaja: (id) => pedir(CANALES.productoBaja, id),
  },
  grupos: {
    guardar: (datos) => pedir(CANALES.grupoGuardar, datos),
    darDeBaja: (id) => pedir(CANALES.grupoBaja, id),
  },
  pedidos: {
    crear: (datos) => pedir(CANALES.pedidoCrear, datos),
    resumenDeHoy: () => pedir(CANALES.pedidoResumenHoy),
    listar: (fecha) => pedir(CANALES.pedidoListar, fecha),
    cambiarEstado: (id, estado) => pedir(CANALES.pedidoEstado, id, estado),
    anular: (id, motivo) => pedir(CANALES.pedidoAnular, id, motivo),
    cobrar: (id, pagos) => pedir(CANALES.pedidoCobrar, id, pagos),
  },
  salon: {
    obtener: () => pedir(CANALES.salonObtener),
    cargarEjemplo: () => pedir(CANALES.salonCargarEjemplo),
    guardarZona: (datos) => pedir(CANALES.zonaGuardar, datos),
    darDeBajaZona: (id) => pedir(CANALES.zonaBaja, id),
    guardarMesa: (datos) => pedir(CANALES.mesaGuardar, datos),
    moverMesa: (id, x, y) => pedir(CANALES.mesaMover, id, { x, y }),
    darDeBajaMesa: (id) => pedir(CANALES.mesaBaja, id),
    abrirMesa: (datos) => pedir(CANALES.mesaAbrir, datos),
    cuenta: (pedidoId) => pedir(CANALES.mesaCuenta, pedidoId),
    agregarRonda: (pedidoId, datos) => pedir(CANALES.mesaRonda, pedidoId, datos),
    editarCuenta: (pedidoId, datos) => pedir(CANALES.mesaEditar, pedidoId, datos),
    pedirCuenta: (pedidoId, pedida) => pedir(CANALES.mesaPedirCuenta, pedidoId, pedida),
    liberar: (pedidoId) => pedir(CANALES.mesaLiberar, pedidoId),
    fijarPropina: (pedidoId, propina) => pedir(CANALES.mesaPropina, pedidoId, propina),
    quitarItem: (pedidoId, datos) => pedir(CANALES.mesaQuitarItem, pedidoId, datos),
    pasarMesa: (pedidoId, mesaId) => pedir(CANALES.mesaPasar, pedidoId, mesaId),
    juntarMesas: (origenId, destinoId) => pedir(CANALES.mesaJuntar, origenId, destinoId),
  },
  clientes: {
    buscar: (texto) => pedir(CANALES.clientesBuscar, texto),
    listar: (filtro) => pedir(CANALES.clientesListar, filtro),
    guardar: (datos) => pedir(CANALES.clientesGuardar, datos),
    pedidos: (id) => pedir(CANALES.clientesPedidos, id),
  },
  reportes: {
    obtener: (rango) => pedir(CANALES.reportesObtener, rango),
    salon: (rango) => pedir(CANALES.reportesSalon, rango),
  },
  impresion: {
    imprimir: (id, tipo) => pedir(CANALES.impresionImprimir, id, tipo),
    pdf: (id, tipo) => pedir(CANALES.impresionPdf, id, tipo),
    impresoras: () => pedir(CANALES.impresionImpresoras),
    ronda: (pedidoId, ronda, destino) => pedir(CANALES.impresionRonda, pedidoId, ronda, destino),
    division: (pedidoId, partes, destino) => pedir(CANALES.impresionDivision, pedidoId, partes, destino),
  },
  configuracion: {
    obtener: () => pedir(CANALES.configuracionObtener),
    guardarImpresion: (datos) => pedir(CANALES.configuracionImpresion, datos),
    guardarLocal: (datos) => pedir(CANALES.configuracionLocal, datos),
  },
  copias: {
    estado: () => pedir(CANALES.copiasEstado),
    exportar: () => pedir(CANALES.copiasExportar),
    elegir: () => pedir(CANALES.copiasElegir),
    restaurar: () => pedir(CANALES.copiasRestaurar),
    abrirCarpeta: () => pedir(CANALES.copiasAbrirCarpeta),
  },
  demo: {
    disponible: () => pedir(CANALES.demoDisponible),
    cargar: () => pedir(CANALES.demoCargar),
  },
  sistema: {
    info: () => pedir(CANALES.sistemaInfo),
  },
  red: {
    estado: () => pedir(CANALES.redEstado),
    configurar: (datos) => pedir(CANALES.redConfigurar, datos),
  },
  cocina: {
    cambiarPin: (pin) => pedir(CANALES.cocinaPin, { pin }),
    abrirVentana: () => pedir(CANALES.cocinaAbrir),
    cambiarEstado: (comandaId, estado) => pedir(CANALES.comandaEstado, comandaId, { estado }),
  },
  // Al revés que los demás: acá habla el MAIN y la ventana escucha
  // (webContents.send → ipcRenderer.on), como el "guardar antes de cerrar"
  // del bloc de notas.
  alCambiar: (fn) => {
    const oyente = (_evento: unknown, cambio: Parameters<typeof fn>[0]) => fn(cambio);
    ipcRenderer.on('cambio', oyente);
    return () => {
      ipcRenderer.removeListener('cambio', oyente);
    };
  },
};

contextBridge.exposeInMainWorld('caja', api);
