// Las mesas en el celular: en la pantalla chica el plano no entra, así que se
// ven como una grilla de fichas por zona, con los mismos colores que en la PC.
import { useState } from 'react';
import { hace, minutosDesde } from '@compartido/salon';
import { pesos } from '@compartido/dinero';
import type { Mesa, Usuario } from '@compartido/tipos';
import { cn } from '@/lib/utils';
import { useAhora } from '@/features/salon/consultas';
import { useSalon } from './consultas';

export function PantallaMesas({ yo, alElegir }: { yo: Usuario; alElegir: (mesaId: number) => void }) {
  const salon = useSalon();
  const ahora = useAhora();
  const [zonaId, setZonaId] = useState<number | 'mias' | null>(null);

  if (salon.isPending) return <p className="p-6 text-tinta-suave">Cargando mesas…</p>;
  if (salon.isError) return <p className="p-6 text-rojo">{salon.error.message}</p>;
  const { zonas, mesas } = salon.data;
  if (mesas.length === 0) return <p className="p-6 text-tinta-suave">Todavía no hay mesas: el dueño las carga en la PC (Salón → Acomodar).</p>;

  const zona = zonaId ?? zonas[0]?.id ?? null;
  const mias = mesas.filter((m) => m.cuenta?.mozoId === yo.id);
  const mostradas = (zona === 'mias' ? mias : mesas.filter((m) => m.zonaId === zona)).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es', { numeric: true }),
  );

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Zonas" className="flex shrink-0 gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
        {[{ id: 'mias' as const, nombre: `Mis mesas · ${mias.length}` }, ...zonas].map((z) => (
          <button
            key={z.id}
            type="button"
            aria-pressed={zona === z.id}
            onClick={() => setZonaId(z.id)}
            className={cn(
              'h-10 shrink-0 rounded-full border px-4 text-[15px] font-semibold whitespace-nowrap outline-none',
              zona === z.id ? 'border-tinta bg-tinta text-white' : 'border-linea bg-superficie text-tinta',
            )}
          >
            {z.nombre}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {mostradas.length === 0 ? (
          <p className="py-10 text-center text-tinta-suave">{zona === 'mias' ? 'No tenés mesas abiertas.' : 'Esta zona no tiene mesas.'}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2.5">
            {mostradas.map((m) => (
              <li key={m.id}>
                <Ficha mesa={m} ahora={ahora} mia={m.cuenta?.mozoId === yo.id} alTocar={() => alElegir(m.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Ficha({ mesa, ahora, mia, alTocar }: { mesa: Mesa; ahora: Date; mia: boolean; alTocar: () => void }) {
  const c = mesa.cuenta;
  return (
    <button
      type="button"
      onClick={alTocar}
      aria-label={`Mesa ${mesa.nombre}, ${mesa.estado === 'libre' ? 'libre' : mesa.estado === 'cuenta' ? 'pidió la cuenta' : 'ocupada'}`}
      className={cn(
        'relative flex aspect-square w-full flex-col items-center justify-center gap-0.5 p-1.5 text-center outline-none active:scale-[0.97]',
        mesa.forma === 'redonda' ? 'rounded-full' : 'rounded-xl',
        mesa.estado === 'cuenta'
          ? 'bg-mostaza text-tinta'
          : mesa.estado === 'ocupada'
            ? 'bg-tinta text-white'
            : 'border-2 border-linea-fuerte bg-superficie text-tinta',
      )}
    >
      {mia && <span aria-label="tu mesa" className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-[#3ccf7f] ring-2 ring-tinta" />}
      <span className="font-display text-[26px] leading-none font-semibold">{mesa.nombre}</span>
      {c ? (
        <>
          <span className="numeros text-[13px] font-bold">{c.totalCentavos > 0 ? pesos(c.totalCentavos) : 'sin pedir'}</span>
          <span className={cn('text-[11px] font-semibold', mesa.estado === 'cuenta' ? 'text-tinta/75' : 'text-white/65')}>
            {mesa.estado === 'cuenta' ? 'cuenta' : (c.mozo ?? 'sin mozo')} · {hace(minutosDesde(c.ultimaRondaEn ?? c.abiertaEn, ahora)).replace('hace ', '')}
          </span>
        </>
      ) : (
        <span className="text-[12px] text-tinta-suave">{mesa.lugares} lugares</span>
      )}
    </button>
  );
}
