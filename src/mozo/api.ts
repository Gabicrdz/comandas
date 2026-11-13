// Cómo habla el celular (o la pantalla de cocina) con la PC: fetch a /api/...
// (misma dirección de la que se cargó la página) con el token en cada pedido.
// La app del mozo y la de cocina usan esto mismo, cada una con su token.

/** Avisa a la app que hay que volver a pedir el PIN. */
export const SESION_VENCIDA = 'sesion-vencida';

export function crearCliente(clave: string, rutaIngreso: string) {
  // localStorage puede fallar (modo incógnito, permisos): si falla, el token
  // queda solo en memoria y habrá que poner el PIN al recargar.
  let enMemoria: string | null = null;
  function tokenGuardado(): string | null {
    try {
      return localStorage.getItem(clave) ?? enMemoria;
    } catch {
      return enMemoria;
    }
  }
  function guardarToken(token: string | null): void {
    enMemoria = token;
    try {
      if (token) localStorage.setItem(clave, token);
      else localStorage.removeItem(clave);
    } catch {
      // sin almacenamiento: queda en memoria
    }
  }

  async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T> {
    const token = tokenGuardado();
    let respuesta: Response;
    try {
      respuesta = await fetch(ruta, {
        method: cuerpo === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
    } catch {
      throw new Error('No hay conexión con la caja. Revisá que este aparato esté en el wifi del local.');
    }
    const datos = (await respuesta.json().catch(() => null)) as T & { error?: string };
    if (!respuesta.ok) {
      if (respuesta.status === 401 && ruta !== rutaIngreso) {
        guardarToken(null);
        window.dispatchEvent(new Event(SESION_VENCIDA));
      }
      throw new Error(datos?.error ?? 'Algo salió mal. Probá de nuevo.');
    }
    return datos;
  }

  return { pedir, tokenGuardado, guardarToken };
}

/** El cliente del celular del mozo. */
export const { pedir, tokenGuardado, guardarToken } = crearCliente('comandas-token', '/api/ingresar');
