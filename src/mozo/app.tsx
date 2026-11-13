// Pantallas del celular: ingreso (nombre + PIN) → mesas → una mesa → cargar ronda.
// Sin router: con tan pocas pantallas alcanza con un estado que dice cuál se ve.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LogOut, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import type { Usuario } from '@compartido/tipos';
import { Marca } from '@/components/layout/marca';
import { Iniciales } from '@/features/sesion/pantalla-ingreso';
import { TecladoPin } from '@/features/sesion/teclado-pin';
import { cn } from '@/lib/utils';
import { guardarToken, pedir, SESION_VENCIDA, tokenGuardado } from './api';
import { useEquipo, useEventos, useHola, useIngresar } from './consultas';
import { PantallaMesas } from './mesas';
import { PantallaMesa } from './mesa';
import { PantallaRonda } from './ronda';

type Vista = { pantalla: 'mesas' } | { pantalla: 'mesa'; mesaId: number } | { pantalla: 'ronda'; mesaId: number };

export function App() {
  const [yo, setYo] = useState<Usuario | null>(null);
  const [revisando, setRevisando] = useState(() => tokenGuardado() !== null);

  // Si quedó un token guardado de antes, preguntamos a la PC si sigue sirviendo.
  useEffect(() => {
    if (!revisando) return;
    pedir<Usuario>('/api/yo')
      .then(setYo, () => guardarToken(null))
      .finally(() => setRevisando(false));
  }, [revisando]);

  useEffect(() => {
    const vencida = () => {
      setYo(null);
      toast.error('Tu sesión se cerró. Volvé a poner tu PIN.');
    };
    window.addEventListener(SESION_VENCIDA, vencida);
    return () => window.removeEventListener(SESION_VENCIDA, vencida);
  }, []);

  if (revisando) return null;
  if (!yo) return <Ingreso alEntrar={setYo} />;
  return (
    <Sistema
      yo={yo}
      alSalir={() => {
        void pedir('/api/salir', {}).catch(() => undefined);
        guardarToken(null);
        setYo(null);
      }}
    />
  );
}

// ───────────────────────── Ingreso ─────────────────────────

function Ingreso({ alEntrar }: { alEntrar: (u: Usuario) => void }) {
  const hola = useHola();
  const equipo = useEquipo();
  const [elegido, setElegido] = useState<Usuario | null>(null);
  const [pin, setPin] = useState('');
  const ingresar = useIngresar();

  function confirmar() {
    if (!elegido || ingresar.isPending) return;
    ingresar.mutate(
      { usuarioId: elegido.id, pin },
      {
        onSuccess: (r) => {
          guardarToken(r.token);
          alEntrar(r.usuario);
        },
        onError: () => setPin(''),
      },
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 bg-riel px-5 pt-[max(16px,env(safe-area-inset-top))] pb-4 text-white">
        <Marca className="size-9" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-semibold">{hola.data?.local ?? 'Comandas'}</p>
          <p className="text-[13px] text-riel-texto">Mozos</p>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center gap-5 px-5 py-6">
        {equipo.isError || hola.isError ? (
          <div className="mt-10 flex flex-col items-center gap-2 text-center">
            <WifiOff className="size-10 text-tinta-suave" />
            <p className="font-display text-lg font-semibold">No hay conexión con la caja</p>
            <p className="text-sm text-tinta-suave">Conectá el celular al wifi del local y recargá la página.</p>
          </div>
        ) : !elegido ? (
          <>
            <h1 className="self-start font-display text-2xl font-semibold tracking-tight">¿Quién sos?</h1>
            <ul className="grid w-full grid-cols-2 gap-3">
              {equipo.data?.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setElegido(u)}
                    className="flex w-full flex-col items-center gap-2 rounded-xl border border-linea bg-superficie px-3 py-4 outline-none active:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/25"
                  >
                    <Iniciales nombre={u.nombre} />
                    <span className="font-semibold">{u.nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setElegido(null);
                setPin('');
                ingresar.reset();
              }}
              className="flex items-center gap-1.5 self-start text-sm font-semibold text-tinta-suave"
            >
              <ArrowLeft className="size-4" /> Cambiar de persona
            </button>
            <div className="flex flex-col items-center gap-2">
              <Iniciales nombre={elegido.nombre} grande />
              <p className="font-display text-2xl font-semibold">Hola, {elegido.nombre}</p>
              <p className="text-sm text-tinta-suave">Poné tu PIN</p>
            </div>
            <TecladoPin valor={pin} alCambiar={setPin} alConfirmar={confirmar} error={ingresar.error?.message} deshabilitado={ingresar.isPending} />
          </>
        )}
      </main>
    </div>
  );
}

// ───────────────────────── Ya adentro ─────────────────────────

function Sistema({ yo, alSalir }: { yo: Usuario; alSalir: () => void }) {
  const [vista, setVista] = useState<Vista>({ pantalla: 'mesas' });
  const conectado = useEventos(true);
  const volver = () => setVista(vista.pantalla === 'ronda' ? { pantalla: 'mesa', mesaId: vista.mesaId } : { pantalla: 'mesas' });

  // El botón "atrás" del celular tiene que volver una pantalla, no salir de la
  // app. Por cada pantalla que entramos dejamos una marca en el historial del
  // navegador (pushState); al tocar "atrás" el navegador la saca (popstate) y
  // nosotros subimos un nivel.
  const profundidad = vista.pantalla === 'mesas' ? 0 : vista.pantalla === 'mesa' ? 1 : 2;
  const anterior = useRef(0);
  useEffect(() => {
    if (profundidad > anterior.current) history.pushState({ profundidad }, '');
    anterior.current = profundidad;
  }, [profundidad]);
  useEffect(() => {
    window.addEventListener('popstate', volver);
    return () => window.removeEventListener('popstate', volver);
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 bg-riel px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 text-white">
        {vista.pantalla !== 'mesas' ? (
          <button type="button" aria-label="Volver" onClick={() => history.back()} className="-ml-1 flex size-10 items-center justify-center rounded-lg active:bg-white/10">
            <ArrowLeft className="size-6" />
          </button>
        ) : (
          <Marca className="size-9" />
        )}
        <p className="flex-1 truncate font-display text-lg font-semibold">{titulo(vista)}</p>
        <span
          className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', conectado ? 'bg-white/10 text-riel-texto' : 'bg-rojo text-white')}
          role="status"
        >
          <span className={cn('size-2 rounded-full', conectado ? 'bg-[#3ccf7f]' : 'bg-white')} />
          {conectado ? yo.nombre : 'Sin conexión'}
        </span>
        {vista.pantalla === 'mesas' && (
          <button type="button" aria-label="Salir" onClick={alSalir} className="flex size-10 items-center justify-center rounded-lg text-riel-texto active:bg-white/10">
            <LogOut className="size-5" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {vista.pantalla === 'mesas' && <PantallaMesas yo={yo} alElegir={(mesaId) => setVista({ pantalla: 'mesa', mesaId })} />}
        {vista.pantalla === 'mesa' && (
          <PantallaMesa
            mesaId={vista.mesaId}
            alAgregar={() => setVista({ pantalla: 'ronda', mesaId: vista.mesaId })}
            alVolver={() => history.back()}
          />
        )}
        {vista.pantalla === 'ronda' && <PantallaRonda mesaId={vista.mesaId} alTerminar={() => history.back()} />}
      </div>
    </div>
  );
}

function titulo(vista: Vista): string {
  if (vista.pantalla === 'mesas') return 'Mesas';
  return vista.pantalla === 'mesa' ? 'Mesa' : 'Agregar pedido';
}
