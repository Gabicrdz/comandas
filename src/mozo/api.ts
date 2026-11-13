// Cómo habla el celular con la PC: fetch a /api/... (misma dirección de la
// que se cargó la página) con el token del mozo en cada pedido.
const CLAVE = 'comandas-token';

// localStorage puede fallar (modo incógnito, permisos): si falla, el token
// queda solo en memoria y habrá que poner el PIN al recargar.
let enMemoria: string | null = null;
export function tokenGuardado(): string | null {
  try {
    return localStorage.getItem(CLAVE) ?? enMemoria;
  } catch {
    return enMemoria;
  }
}
export function guardarToken(token: string | null): void {
  enMemoria = token;
  try {
    if (token) localStorage.setItem(CLAVE, token);
    else localStorage.removeItem(CLAVE);
  } catch {
    // sin almacenamiento: queda en memoria
  }
}

/** Avisa a la app que hay que volver a pedir el PIN. */
export const SESION_VENCIDA = 'sesion-vencida';

export async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const token = tokenGuardado();
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new Error('No hay conexión con la caja. Revisá que el celular esté en el wifi del local.');
  }
  const datos = (await respuesta.json().catch(() => null)) as T & { error?: string };
  if (!respuesta.ok) {
    if (respuesta.status === 401 && ruta !== '/api/ingresar') {
      guardarToken(null);
      window.dispatchEvent(new Event(SESION_VENCIDA));
    }
    throw new Error(datos?.error ?? 'Algo salió mal. Probá de nuevo.');
  }
  return datos;
}
