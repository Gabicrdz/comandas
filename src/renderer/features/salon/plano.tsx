// El plano de una zona: una grilla de casilleros con las mesas encima.
// Modo normal: tocar una mesa la elige. Modo "acomodar" (solo el dueño):
// las mesas se arrastran con el mouse o se mueven con las flechas.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { COLUMNAS_SALON, FILAS_SALON } from '@compartido/esquemas';
import { anchoDe, duracionCorta, hace, lugarDisponible, minutosDesde, type Lugar } from '@compartido/salon';
import { pesos } from '@compartido/dinero';
import type { Mesa } from '@compartido/tipos';
import { cn } from '@/lib/utils';

interface Props {
  mesas: Mesa[];
  ahora: Date;
  elegida: number | null;
  acomodando: boolean;
  alElegir: (mesa: Mesa) => void;
  /** Solo acomodando: soltar una mesa en otro casillero. */
  alMover: (mesa: Mesa, lugar: Lugar) => void;
  /** Solo acomodando: tocar (sin arrastrar) para editarla. */
  alEditar: (mesa: Mesa) => void;
}

interface Arrastre {
  mesa: Mesa;
  /** Cuántos casilleros a la derecha del borde agarró la mesa (en una larga, 0 o 1). */
  agarre: number;
  inicio: { x: number; y: number };
  destino: Lugar;
  seMovio: boolean;
}

export function Plano({ mesas, ahora, elegida, acomodando, alElegir, alMover, alEditar }: Props) {
  const grilla = useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);

  /** En qué casillero cae un punto de la pantalla. */
  function casillero(clientX: number, clientY: number): Lugar {
    const r = grilla.current!.getBoundingClientRect();
    return {
      x: Math.min(COLUMNAS_SALON - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * COLUMNAS_SALON))),
      y: Math.min(FILAS_SALON - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * FILAS_SALON))),
    };
  }

  function alApretar(e: PointerEvent<HTMLButtonElement>, mesa: Mesa) {
    if (!acomodando || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = casillero(e.clientX, e.clientY);
    setArrastre({ mesa, agarre: Math.max(0, c.x - mesa.x), inicio: { x: e.clientX, y: e.clientY }, destino: { x: mesa.x, y: mesa.y }, seMovio: false });
  }

  function alMoverPuntero(e: PointerEvent<HTMLButtonElement>) {
    if (!arrastre) return;
    const seMovio = arrastre.seMovio || Math.hypot(e.clientX - arrastre.inicio.x, e.clientY - arrastre.inicio.y) > 6;
    const c = casillero(e.clientX, e.clientY);
    setArrastre({ ...arrastre, seMovio, destino: { x: c.x - arrastre.agarre, y: c.y } });
  }

  function alSoltar() {
    if (!arrastre) return;
    const { mesa, destino, seMovio } = arrastre;
    setArrastre(null);
    if (!seMovio) {
      alEditar(mesa);
      return;
    }
    if ((destino.x !== mesa.x || destino.y !== mesa.y) && lugarDisponible(mesa.forma, destino, mesas, mesa.id)) alMover(mesa, destino);
  }

  /** Acomodando, las flechas mueven la mesa un casillero. */
  function alTeclear(e: KeyboardEvent<HTMLButtonElement>, mesa: Mesa) {
    if (!acomodando) return;
    const paso = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!paso) return;
    e.preventDefault();
    const destino = { x: mesa.x + paso[0]!, y: mesa.y + paso[1]! };
    if (lugarDisponible(mesa.forma, destino, mesas, mesa.id)) alMover(mesa, destino);
  }

  const destinoValido = arrastre ? lugarDisponible(arrastre.mesa.forma, arrastre.destino, mesas, arrastre.mesa.id) : false;

  return (
    <div
      ref={grilla}
      className={cn(
        'relative grid h-full w-full gap-2 rounded-2xl p-2',
        acomodando && 'bg-superficie/50 ring-2 ring-mostaza ring-inset',
      )}
      style={{ gridTemplateColumns: `repeat(${COLUMNAS_SALON}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${FILAS_SALON}, minmax(0, 1fr))` }}
    >
      {/* Casilleros: se ven solo al acomodar, para saber dónde se puede soltar. */}
      {acomodando &&
        Array.from({ length: COLUMNAS_SALON * FILAS_SALON }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="rounded-lg border border-dashed border-linea-fuerte/80"
            style={{ gridColumn: (i % COLUMNAS_SALON) + 1, gridRow: Math.floor(i / COLUMNAS_SALON) + 1 }}
          />
        ))}

      {/* Dónde caería la mesa que estás arrastrando. */}
      {arrastre?.seMovio && (
        <span
          aria-hidden="true"
          className={cn('z-10 rounded-xl border-[3px] border-dashed', destinoValido ? 'border-verde bg-verde-suave/60' : 'border-rojo bg-rojo-suave/60')}
          style={{
            gridColumn: `${Math.max(0, arrastre.destino.x) + 1} / span ${anchoDe(arrastre.mesa.forma)}`,
            gridRow: Math.max(0, arrastre.destino.y) + 1,
          }}
        />
      )}

      {mesas.map((mesa) => (
        <button
          key={mesa.id}
          type="button"
          onClick={(e) => {
            if (!acomodando) alElegir(mesa);
            else if (e.detail === 0) alEditar(mesa); // Enter o espacio (con el mouse lo resuelve alSoltar)
          }}
          onPointerDown={(e) => alApretar(e, mesa)}
          onPointerMove={alMoverPuntero}
          onPointerUp={alSoltar}
          onPointerCancel={() => setArrastre(null)}
          onKeyDown={(e) => alTeclear(e, mesa)}
          aria-pressed={!acomodando ? elegida === mesa.id : undefined}
          aria-label={etiqueta(mesa, ahora, acomodando)}
          // El botón ocupa el casillero entero; adentro se dibuja la mesa con su forma.
          // "@container" deja medir el casillero: una cuadrada o redonda usa el lado
          // más corto (así no se deforma) y la larga, todo el ancho.
          className={cn(
            'group @container relative z-20 flex min-h-0 min-w-0 touch-none items-center justify-center outline-none select-none',
            acomodando && 'cursor-grab active:cursor-grabbing',
            arrastre?.mesa.id === mesa.id && arrastre.seMovio && 'opacity-40',
          )}
          style={{ gridColumn: `${mesa.x + 1} / span ${anchoDe(mesa.forma)}`, gridRow: mesa.y + 1 }}
        >
          <span
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 overflow-hidden p-1.5 text-center transition-[box-shadow,transform]',
              'group-focus-visible:ring-[3px] group-focus-visible:ring-tinta group-focus-visible:ring-offset-2',
              mesa.forma === 'larga' ? 'h-[min(100cqh,58cqw)] w-full rounded-xl' : 'size-[min(100cqw,100cqh)]',
              mesa.forma === 'redonda' ? 'rounded-full' : 'rounded-xl',
              colores(mesa),
              elegida === mesa.id && !acomodando && 'ring-[3px] ring-mostaza ring-offset-[3px] ring-offset-fondo',
            )}
          >
            <Contenido mesa={mesa} ahora={ahora} acomodando={acomodando} />
          </span>
        </button>
      ))}
    </div>
  );
}

function colores(mesa: Mesa): string {
  if (mesa.estado === 'cuenta') return 'bg-mostaza text-tinta shadow-[0_2px_0_var(--mostaza-fuerte)]';
  if (mesa.estado === 'ocupada') return 'bg-tinta text-white shadow-[0_2px_0_#000]';
  return 'border-2 border-linea-fuerte bg-superficie text-tinta hover:border-tinta-suave';
}

function Contenido({ mesa, ahora, acomodando }: { mesa: Mesa; ahora: Date; acomodando: boolean }) {
  const c = mesa.cuenta;
  if (!c || acomodando) {
    return (
      <>
        <span className="font-display text-[clamp(20px,22cqmin,40px)] leading-none font-semibold tracking-tight">{mesa.nombre}</span>
        <span className={cn('text-[clamp(11px,9cqmin,15px)] font-semibold', c ? 'opacity-70' : 'text-tinta-suave')}>
          {mesa.lugares} {mesa.lugares === 1 ? 'lugar' : 'lugares'}
        </span>
      </>
    );
  }
  const espera = minutosDesde(c.cuentaPedidaEn ?? c.ultimaRondaEn ?? c.abiertaEn, ahora);
  const redonda = mesa.forma === 'redonda';
  return (
    <>
      <span className="font-display text-[clamp(20px,22cqmin,40px)] leading-none font-semibold tracking-tight">{mesa.nombre}</span>
      <span className="numeros text-[clamp(13px,12cqmin,20px)] leading-tight font-bold">{c.totalCentavos > 0 ? pesos(c.totalCentavos) : 'sin pedir'}</span>
      <span className={cn('text-[clamp(11px,9cqmin,15px)] leading-tight font-semibold', mesa.estado === 'cuenta' ? 'text-tinta/75' : 'text-white/65')}>
        {mesa.estado === 'cuenta' ? `cuenta · ${duracionCorta(espera)}` : redonda ? duracionCorta(espera) : `${c.comensales ?? '–'} pers · ${duracionCorta(espera)}`}
      </span>
    </>
  );
}

function etiqueta(mesa: Mesa, ahora: Date, acomodando: boolean): string {
  if (acomodando) return `Mesa ${mesa.nombre}, ${mesa.lugares} lugares. Arrastrala o usá las flechas para moverla; Enter para editarla.`;
  const c = mesa.cuenta;
  if (!c) return `Mesa ${mesa.nombre}, libre, ${mesa.lugares} lugares`;
  const minutos = minutosDesde(c.abiertaEn, ahora);
  return `Mesa ${mesa.nombre}, ${mesa.estado === 'cuenta' ? 'pidió la cuenta' : 'ocupada'}, ${c.comensales ?? 'sin dato de'} personas, ${pesos(c.totalCentavos)}, abierta ${hace(minutos)}`;
}
