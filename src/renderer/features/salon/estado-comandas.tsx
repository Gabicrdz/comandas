// Cómo va cada sector con una ronda: "Cocina · preparando", "Barra · lista".
// Lo usan la cuenta de la mesa en la PC y en el celular del mozo.
import { Check, ChefHat, CupSoda } from 'lucide-react';
import { NOMBRE_ESTADO_COMANDA, NOMBRE_SECTOR, type ComandaResumen } from '@compartido/tipos';
import { cn } from '@/lib/utils';

const COLOR = {
  pendiente: 'bg-secondary text-tinta-suave',
  preparando: 'bg-mostaza-suave text-[#6b4f00]',
  lista: 'bg-verde text-white',
  entregada: 'bg-transparent text-tinta-suave line-through decoration-1',
} as const;

export function EstadoComandas({ comandas, alEntregar }: { comandas: ComandaResumen[]; alEntregar?: (id: number) => void }) {
  if (comandas.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5 normal-case">
      {comandas.map((c) => {
        const Icono = c.sector === 'barra' ? CupSoda : ChefHat;
        const texto = `${NOMBRE_SECTOR[c.sector]} · ${NOMBRE_ESTADO_COMANDA[c.estado].toLowerCase()}`;
        const clase = cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-semibold tracking-normal', COLOR[c.estado]);
        // Lo que está listo se puede marcar como llevado a la mesa con un toque.
        return c.estado === 'lista' && alEntregar ? (
          <button
            key={c.id}
            type="button"
            onClick={() => alEntregar(c.id)}
            title="Tocá cuando lo lleven a la mesa"
            className={cn(clase, 'outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-tinta')}
          >
            <Icono className="size-3.5" /> {NOMBRE_SECTOR[c.sector]} · ¡lista! <Check className="size-3.5" />
          </button>
        ) : (
          <span key={c.id} className={clase}>
            <Icono className="size-3.5" /> {texto}
          </span>
        );
      })}
    </span>
  );
}
