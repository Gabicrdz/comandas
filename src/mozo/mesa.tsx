// Una mesa en el celular: abrirla (si está libre) o ver su cuenta y pedir más.
import { useState } from 'react';
import { BellRing, Plus, UndoDot, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { hace, minutosDesde } from '@compartido/salon';
import { pesos } from '@compartido/dinero';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Contador } from '@/features/vender/dialogo-armar';
import { useAhora } from '@/features/salon/consultas';
import { useAbrirMesa, useCuenta, useEntregarComanda, usePedirCuenta, useSalon } from './consultas';
import { EstadoComandas } from '@/features/salon/estado-comandas';

export function PantallaMesa({ mesaId, alAgregar, alVolver }: { mesaId: number; alAgregar: () => void; alVolver: () => void }) {
  const salon = useSalon();
  const ahora = useAhora();
  const mesa = salon.data?.mesas.find((m) => m.id === mesaId);
  const cuenta = useCuenta(mesa?.cuenta?.pedidoId ?? null);
  const abrir = useAbrirMesa();
  const pedirCuenta = usePedirCuenta();
  const entregar = useEntregarComanda();
  const [comensales, setComensales] = useState(2);

  if (!mesa) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-tinta-suave">{salon.isPending ? 'Cargando…' : 'Esa mesa ya no está en el salón.'}</p>
        {!salon.isPending && <Button onClick={alVolver}>Volver a las mesas</Button>}
      </div>
    );
  }

  const encabezado = (
    <div className="border-b border-linea bg-superficie px-5 pt-4 pb-3">
      <p className={cn('text-[12px] font-semibold tracking-wide uppercase', mesa.estado === 'cuenta' ? 'text-[#7a5a00]' : 'text-tinta-suave')}>
        {mesa.estado === 'libre'
          ? `Libre · ${mesa.lugares} lugares`
          : mesa.estado === 'cuenta'
            ? `Pidió la cuenta ${hace(minutosDesde(mesa.cuenta!.cuentaPedidaEn!, ahora))}`
            : `Ocupada · ${hace(minutosDesde(mesa.cuenta!.abiertaEn, ahora))}`}
      </p>
      <h1 className="font-display text-[34px] leading-tight font-semibold tracking-tight">Mesa {mesa.nombre}</h1>
      {mesa.cuenta && (
        <p className="flex items-center gap-1.5 text-sm text-tinta-suave">
          <UsersRound className="size-4" /> {mesa.cuenta.comensales ?? '–'} personas · {mesa.cuenta.mozo ?? 'sin mozo'}
        </p>
      )}
    </div>
  );

  // ── Libre: se sientan ──
  if (!mesa.cuenta) {
    return (
      <form
        className="flex h-full flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          abrir.mutate(
            { mesaId: mesa.id, comensales },
            { onSuccess: () => alAgregar(), onError: (error) => toast.error(error.message) },
          );
        }}
      >
        {encabezado}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5">
          <span className="font-display text-xl font-semibold">¿Cuántos son?</span>
          <Contador valor={comensales} alCambiar={setComensales} etiqueta="Personas" />
        </div>
        <div className="border-t border-linea bg-superficie px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <Button type="submit" size="lg" className="h-14 w-full text-[17px]" disabled={abrir.isPending}>
            <UsersRound /> Abrir mesa · {comensales} {comensales === 1 ? 'persona' : 'personas'}
          </Button>
        </div>
      </form>
    );
  }

  // ── Ocupada: la cuenta ──
  const p = cuenta.data;
  const vacia = mesa.cuenta.unidades === 0;
  return (
    <div className="flex h-full flex-col">
      {encabezado}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {vacia ? (
          <p className="px-5 py-10 text-center text-tinta-suave">Todavía no pidieron nada.</p>
        ) : (
          p?.rondas.map((r) => (
            <section key={r.numero} className="border-b border-linea">
              <div className="flex flex-col gap-1.5 bg-[#fafaf8] px-5 py-1.5">
                <h2 className="text-[12px] font-semibold tracking-wide text-tinta-suave uppercase">
                  Ronda {r.numero} · {r.hora}
                  {r.usuario ? ` · ${r.usuario}` : ''}
                </h2>
                <EstadoComandas
                  comandas={p.comandas.filter((c) => c.ronda === r.numero)}
                  alEntregar={(id) => entregar.mutate(id, { onSuccess: () => toast.success('Listo: marcado como llevado'), onError: (e) => toast.error(e.message) })}
                />
              </div>
              <ul className="divide-y divide-linea/70">
                {p.items
                  .filter((i) => i.ronda === r.numero)
                  .map((i) => (
                    <li key={i.id} className="flex gap-3 px-5 py-2.5">
                      <span className="numeros w-6 shrink-0 font-semibold">{i.cantidad}×</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">
                          {i.nombre}
                          {i.varianteNombre && <span className="font-normal text-tinta-suave"> · {i.varianteNombre}</span>}
                        </span>
                        {i.agregados.length > 0 && <span className="text-[13px] text-tinta-suave">{i.agregados.map((a) => a.nombre).join(' · ')}</span>}
                        {i.nota && <span className="text-[13px] italic">“{i.nota}”</span>}
                      </span>
                      <span className="numeros font-display font-semibold">{pesos(i.totalCentavos)}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-linea bg-superficie px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">Total</span>
          <span className="numeros font-display text-[28px] leading-none font-semibold">{pesos(mesa.cuenta.totalCentavos)}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button size="lg" className="h-14 text-[17px]" onClick={alAgregar}>
            <Plus /> Agregar pedido
          </Button>
          {mesa.estado === 'cuenta' ? (
            <Button
              size="lg"
              variant="outline"
              className="h-14"
              disabled={pedirCuenta.isPending}
              onClick={() => pedirCuenta.mutate({ pedidoId: mesa.cuenta!.pedidoId, pedida: false }, { onError: (e) => toast.error(e.message) })}
            >
              <UndoDot /> No era
            </Button>
          ) : (
            <Button
              size="lg"
              variant="oscuro"
              className="h-14"
              disabled={vacia || pedirCuenta.isPending}
              onClick={() =>
                pedirCuenta.mutate(
                  { pedidoId: mesa.cuenta!.pedidoId, pedida: true },
                  { onSuccess: () => toast.success('Avisado a la caja: la mesa pide la cuenta'), onError: (e) => toast.error(e.message) },
                )
              }
            >
              <BellRing /> Cuenta
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
