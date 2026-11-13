// La pantalla de cocina: tres columnas (en espera, preparando, listas) con una
// tarjeta por comanda. Un toque grande avanza el estado; la flechita vuelve
// atrás si alguien se equivocó. Suena cuando entra algo nuevo.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChefHat, Expand, Lock, Undo2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { duracionCorta, minutosDesde } from '@compartido/salon';
import { NOMBRE_SECTOR, NOMBRE_TIPO, type Comanda, type EstadoComanda, type Sector } from '@compartido/tipos';
import { Marca } from '@/components/layout/marca';
import { TecladoPin } from '@/features/sesion/teclado-pin';
import { cn } from '@/lib/utils';
import { useAhora } from '@/features/salon/consultas';
import { crearCliente, SESION_VENCIDA } from '../mozo/api';

const { pedir, tokenGuardado, guardarToken } = crearCliente('comandas-cocina-token', '/api/cocina/ingresar');
type Filtro = Sector | 'todos';
const CLAVE_FILTRO = 'comandas-cocina-sector';

function filtroGuardado(): Filtro {
  try {
    const v = localStorage.getItem(CLAVE_FILTRO);
    return v === 'cocina' || v === 'barra' ? v : 'todos';
  } catch {
    return 'todos';
  }
}

export function App() {
  const [adentro, setAdentro] = useState(() => tokenGuardado() !== null);
  useEffect(() => {
    const salir = () => setAdentro(false);
    window.addEventListener(SESION_VENCIDA, salir);
    return () => window.removeEventListener(SESION_VENCIDA, salir);
  }, []);
  return adentro ? <Pantalla alBloquear={() => (guardarToken(null), setAdentro(false))} /> : <Ingreso alEntrar={() => setAdentro(true)} />;
}

function Ingreso({ alEntrar }: { alEntrar: () => void }) {
  const [pin, setPin] = useState('');
  const ingresar = useMutation({
    mutationFn: () => pedir<{ token: string }>('/api/cocina/ingresar', { pin }),
    onSuccess: (r) => {
      guardarToken(r.token);
      alEntrar();
    },
    onError: () => setPin(''),
  });
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-riel p-6 text-white">
      <div className="flex flex-col items-center gap-3">
        <Marca className="size-14" />
        <h1 className="font-display text-3xl font-semibold">Pantalla de cocina</h1>
        <p className="text-riel-texto">Poné el PIN de cocina (lo elige el dueño en Ajustes).</p>
      </div>
      <div className="rounded-2xl bg-fondo p-6 text-tinta">
        <TecladoPin valor={pin} alCambiar={setPin} alConfirmar={() => pin && ingresar.mutate()} error={ingresar.error?.message} deshabilitado={ingresar.isPending} />
      </div>
    </div>
  );
}

/** Un "ding-ding" para que la cocina se entere aunque no esté mirando. */
function sonar(): void {
  try {
    const audio = new AudioContext();
    [0, 0.18].forEach((t) => {
      const tono = audio.createOscillator();
      const volumen = audio.createGain();
      tono.frequency.value = 988;
      volumen.gain.setValueAtTime(0.2, audio.currentTime + t);
      volumen.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.25);
      tono.connect(volumen).connect(audio.destination);
      tono.start(audio.currentTime + t);
      tono.stop(audio.currentTime + t + 0.25);
    });
    setTimeout(() => void audio.close(), 800);
  } catch {
    // sin sonido no pasa nada
  }
}

function useEventosCocina(): boolean {
  const cliente = useQueryClient();
  const [conectado, setConectado] = useState(true);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    const token = tokenGuardado();
    if (!token) return;
    const fuente = new EventSource(`/api/eventos?token=${encodeURIComponent(token)}`);
    let reintento: number | undefined;
    const refrescar = () => void cliente.invalidateQueries({ queryKey: ['comandas'] });
    fuente.addEventListener('hola', () => {
      setConectado(true);
      refrescar();
    });
    fuente.addEventListener('cambio', refrescar);
    fuente.onerror = () => {
      setConectado(false);
      if (fuente.readyState === EventSource.CLOSED) {
        void pedir('/api/cocina/comandas').catch(() => undefined); // si el PIN venció, vuelve al ingreso
        reintento = window.setTimeout(() => setIntento((n) => n + 1), 5000);
      }
    };
    return () => {
      fuente.close();
      window.clearTimeout(reintento);
    };
  }, [cliente, intento]);
  return conectado;
}

const COLUMNAS: { estado: EstadoComanda; titulo: string }[] = [
  { estado: 'pendiente', titulo: 'En espera' },
  { estado: 'preparando', titulo: 'Preparando' },
  { estado: 'lista', titulo: 'Listas para llevar' },
];

function Pantalla({ alBloquear }: { alBloquear: () => void }) {
  const [filtro, setFiltro] = useState<Filtro>(filtroGuardado);
  const ahora = useAhora(15_000);
  const conectado = useEventosCocina();
  const cliente = useQueryClient();
  const comandas = useQuery({
    queryKey: ['comandas', filtro],
    queryFn: () => pedir<Comanda[]>(`/api/cocina/comandas?sector=${filtro}`),
    refetchInterval: 20_000,
  });
  const mover = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: EstadoComanda }) => pedir<null>(`/api/cocina/comandas/${id}/estado`, { estado }),
    onSettled: () => cliente.invalidateQueries({ queryKey: ['comandas'] }),
    onError: (e) => toast.error(e.message),
  });

  // Suena cuando aparece una comanda que antes no estaba (no en la primera carga).
  const conocidas = useRef<Set<number> | null>(null);
  const [nuevas, setNuevas] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!comandas.data) return;
    const ids = new Set(comandas.data.map((c) => c.id));
    if (conocidas.current) {
      const recien = comandas.data.filter((c) => c.estado === 'pendiente' && !conocidas.current!.has(c.id)).map((c) => c.id);
      if (recien.length > 0) {
        sonar();
        setNuevas(new Set(recien));
        window.setTimeout(() => setNuevas(new Set()), 6000);
      }
    }
    conocidas.current = ids;
  }, [comandas.data]);

  function elegir(f: Filtro) {
    setFiltro(f);
    conocidas.current = null;
    try {
      localStorage.setItem(CLAVE_FILTRO, f);
    } catch {
      // no pasa nada
    }
  }

  const lista = comandas.data ?? [];
  return (
    <div className="flex h-full flex-col bg-[#26272a]">
      <header className="flex items-center gap-4 bg-riel px-5 py-3 text-white">
        <Marca className="size-9" />
        <nav aria-label="Sector" className="flex gap-1 rounded-lg bg-white/10 p-1">
          {(['todos', 'cocina', 'barra'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filtro === f}
              onClick={() => elegir(f)}
              className={cn('h-10 rounded-md px-5 text-[16px] font-semibold', filtro === f ? 'bg-mostaza text-tinta' : 'text-riel-texto hover:text-white')}
            >
              {f === 'todos' ? 'Todo' : NOMBRE_SECTOR[f]}
            </button>
          ))}
        </nav>
        <span className="flex-1" />
        {!conectado && (
          <span role="status" className="flex items-center gap-2 rounded-full bg-rojo px-3 py-1.5 text-sm font-semibold">
            <WifiOff className="size-4" /> Sin conexión con la caja
          </span>
        )}
        <span className="numeros font-display text-2xl font-semibold">
          {ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <button type="button" aria-label="Pantalla completa" onClick={() => void document.documentElement.requestFullscreen?.()} className="flex size-10 items-center justify-center rounded-lg text-riel-texto hover:bg-white/10">
          <Expand className="size-5" />
        </button>
        <button type="button" aria-label="Bloquear pantalla" onClick={alBloquear} className="flex size-10 items-center justify-center rounded-lg text-riel-texto hover:bg-white/10">
          <Lock className="size-5" />
        </button>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-3 gap-4 p-4">
        {COLUMNAS.map((col) => {
          const deLaColumna = lista.filter((c) => c.estado === col.estado);
          return (
            <section key={col.estado} aria-label={col.titulo} className="flex min-h-0 flex-col gap-3">
              <h2 className="flex items-baseline gap-2 px-1 text-white">
                <span className="font-display text-xl font-semibold">{col.titulo}</span>
                <span className="numeros text-lg text-riel-texto">{deLaColumna.length}</span>
              </h2>
              <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                {deLaColumna.map((c) => (
                  <li key={c.id}>
                    <Tarjeta
                      comanda={c}
                      ahora={ahora}
                      nueva={nuevas.has(c.id)}
                      mostrarSector={filtro === 'todos'}
                      ocupado={mover.isPending}
                      alMover={(estado) => mover.mutate({ id: c.id, estado })}
                    />
                  </li>
                ))}
                {deLaColumna.length === 0 && (
                  <li className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-white/10 py-10 text-riel-texto">
                    {col.estado === 'pendiente' && <ChefHat className="size-8" />}
                    {col.estado === 'pendiente' ? 'No hay nada en espera' : 'Nada por acá'}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}

const SIGUIENTE: Record<EstadoComanda, { estado: EstadoComanda; texto: string } | null> = {
  pendiente: { estado: 'preparando', texto: 'Empezar' },
  preparando: { estado: 'lista', texto: '¡Lista!' },
  lista: { estado: 'entregada', texto: 'Ya la llevaron' },
  entregada: null,
};
const ANTERIOR: Partial<Record<EstadoComanda, EstadoComanda>> = { preparando: 'pendiente', lista: 'preparando' };

function Tarjeta({
  comanda: c,
  ahora,
  nueva,
  mostrarSector,
  ocupado,
  alMover,
}: {
  comanda: Comanda;
  ahora: Date;
  nueva: boolean;
  mostrarSector: boolean;
  ocupado: boolean;
  alMover: (estado: EstadoComanda) => void;
}) {
  const espera = minutosDesde(c.creadaEn, ahora);
  // Más de 10 minutos esperando: amarillo; más de 20: rojo. (Las listas, en verde.)
  const urgencia = c.estado === 'lista' ? 'lista' : espera >= 20 ? 'roja' : espera >= 10 ? 'amarilla' : 'normal';
  const titulo = c.mesa ? `Mesa ${c.mesa}` : `#${c.numero} · ${NOMBRE_TIPO[c.tipo]}`;
  const siguiente = SIGUIENTE[c.estado];
  const anterior = ANTERIOR[c.estado];
  return (
    <article
      aria-label={`${titulo}, ${NOMBRE_SECTOR[c.sector]}, hace ${duracionCorta(espera)}`}
      className={cn('overflow-hidden rounded-xl bg-white text-tinta shadow-lg transition-shadow', nueva && 'ring-4 ring-mostaza')}
    >
      <header
        className={cn(
          'flex items-start justify-between gap-3 px-4 py-2.5',
          urgencia === 'roja' ? 'bg-rojo text-white' : urgencia === 'amarilla' ? 'bg-mostaza' : urgencia === 'lista' ? 'bg-verde text-white' : 'bg-tinta text-white',
        )}
      >
        <div className="min-w-0">
          <p className="truncate font-display text-[22px] leading-tight font-semibold">{titulo}</p>
          <p className="truncate text-[13px] font-semibold opacity-80">
            {c.mesa ? `Ronda ${c.ronda}${c.mozo ? ` · ${c.mozo}` : ''}` : c.clienteNombre || 'Sin nombre'}
            {mostrarSector ? ` · ${NOMBRE_SECTOR[c.sector]}` : ''}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          {nueva && <span className="rounded bg-mostaza px-1.5 py-0.5 text-[12px] font-bold tracking-wide text-tinta uppercase">Nueva</span>}
          <span className="numeros font-display text-[22px] font-semibold">{duracionCorta(espera)}</span>
        </span>
      </header>
      <ul className="divide-y divide-linea px-4">
        {c.items.map((i) => (
          <li key={i.id} className="flex gap-3 py-2">
            <span className="numeros w-8 shrink-0 font-display text-[22px] leading-tight font-semibold">{i.cantidad}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[18px] leading-tight font-semibold">
                {i.nombre}
                {i.varianteNombre && <span className="font-normal"> · {i.varianteNombre}</span>}
              </p>
              {i.agregados.length > 0 && <p className="text-[15px] text-tinta-suave">{i.agregados.map((a) => a.nombre).join(' · ')}</p>}
              {i.nota && <p className="mt-1 inline-block rounded bg-mostaza-suave px-1.5 text-[15px] font-semibold">⚠ {i.nota}</p>}
            </div>
          </li>
        ))}
      </ul>
      {c.nota && <p className="mx-4 mb-2 rounded bg-mostaza-suave px-2 py-1 text-[14px] font-semibold">Nota del pedido: {c.nota}</p>}
      <footer className="flex gap-2 border-t border-linea p-2">
        {anterior && (
          <button
            type="button"
            aria-label="Volver un paso atrás"
            disabled={ocupado}
            onClick={() => alMover(anterior)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-linea text-tinta-suave hover:bg-accent"
          >
            <Undo2 className="size-5" />
          </button>
        )}
        {siguiente && (
          <button
            type="button"
            disabled={ocupado}
            onClick={() => alMover(siguiente.estado)}
            className={cn(
              'h-12 flex-1 rounded-lg text-[18px] font-semibold',
              c.estado === 'preparando' ? 'bg-verde text-white' : c.estado === 'lista' ? 'border border-linea text-tinta-suave' : 'bg-tinta text-white',
            )}
          >
            {siguiente.texto}
          </button>
        )}
      </footer>
    </article>
  );
}
