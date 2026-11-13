// El panel de la derecha: el resumen del salón, "sentar gente" en una mesa
// libre o la cuenta de una mesa ocupada (rondas, total y botones).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BellRing, CircleDollarSign, Pencil, Plus, Printer, Receipt, UndoDot, UsersRound } from 'lucide-react';
import { hace, minutosDesde } from '@compartido/salon';
import { pesos } from '@compartido/dinero';
import type { Mesa, PedidoDetalle, Salon, Usuario } from '@compartido/tipos';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { caja } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Contador } from '@/features/vender/dialogo-armar';
import { useImprimir } from '@/features/pedidos/consultas';
import { useAccionSalon, useCuenta } from './consultas';
import { EstadoComandas } from './estado-comandas';

// ───────────────────────── Resumen (ninguna mesa elegida) ─────────────────────────

export function PanelResumen({ salon, ahora, alElegir }: { salon: Salon; ahora: Date; alElegir: (m: Mesa) => void }) {
  const ocupadas = salon.mesas.filter((m) => m.cuenta);
  const personas = ocupadas.reduce((s, m) => s + (m.cuenta!.comensales ?? 0), 0);
  const abierto = ocupadas.reduce((s, m) => s + m.cuenta!.totalCentavos, 0);
  // Primero las que piden la cuenta; después las que hace más que no piden nada.
  const orden = [...ocupadas].sort((a, b) => {
    if ((a.estado === 'cuenta') !== (b.estado === 'cuenta')) return a.estado === 'cuenta' ? -1 : 1;
    const ta = a.cuenta!.cuentaPedidaEn ?? a.cuenta!.ultimaRondaEn ?? a.cuenta!.abiertaEn;
    const tb = b.cuenta!.cuentaPedidaEn ?? b.cuenta!.ultimaRondaEn ?? b.cuenta!.abiertaEn;
    return ta.localeCompare(tb);
  });
  const zona = (id: number) => salon.zonas.find((z) => z.id === id)?.nombre ?? '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-linea px-5 pt-5 pb-4">
        <h2 className="font-display text-2xl font-semibold tracking-tight">El salón ahora</h2>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          <Dato titulo="Mesas ocupadas" valor={`${ocupadas.length} de ${salon.mesas.length}`} />
          <Dato titulo="Personas" valor={String(personas)} />
          <Dato titulo="Sin cobrar" valor={pesos(abierto)} />
        </dl>
      </div>
      {orden.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <UsersRound className="size-9 text-linea-fuerte" strokeWidth={1.5} />
          <p className="font-display text-lg font-semibold">Todas las mesas libres</p>
          <p className="text-sm text-tinta-suave">Tocá una mesa del plano para sentar gente.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-linea overflow-y-auto">
          {orden.map((m) => {
            const c = m.cuenta!;
            const desde = c.cuentaPedidaEn ?? c.ultimaRondaEn ?? c.abiertaEn;
            return (
              <li key={m.id}>
                <button type="button" onClick={() => alElegir(m)} className="flex w-full items-center gap-3 px-5 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent">
                  <span
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-lg font-display text-lg font-semibold',
                      m.estado === 'cuenta' ? 'bg-mostaza text-tinta' : 'bg-tinta text-white',
                    )}
                  >
                    {m.nombre}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">
                      {m.estado === 'cuenta' ? 'Pidió la cuenta' : c.rondas === 0 ? 'Todavía no pidió' : `${c.rondas} ${c.rondas === 1 ? 'ronda' : 'rondas'}`}
                    </span>
                    <span className="truncate text-[13px] text-tinta-suave">
                      {zona(m.zonaId)} · {c.comensales ?? '–'} pers{c.mozo ? ` · ${c.mozo}` : ''}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="numeros font-display font-semibold">{pesos(c.totalCentavos)}</span>
                    <span className={cn('text-[12px] font-semibold', m.estado === 'cuenta' ? 'text-[#7a5a00]' : 'text-tinta-suave')}>
                      {hace(minutosDesde(desde, ahora))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] font-semibold text-tinta-suave">{titulo}</dt>
      <dd className="numeros font-display text-[19px] leading-tight font-semibold">{valor}</dd>
    </div>
  );
}

// ───────────────────────── Elegir mozo y personas ─────────────────────────

function SelectorMozo({ mozos, valor, alCambiar }: { mozos: Usuario[]; valor: number | null; alCambiar: (id: number | null) => void }) {
  const opciones: { id: number | null; nombre: string; rol?: string }[] = [...mozos, { id: null, nombre: 'Sin mozo' }];
  return (
    <div role="radiogroup" aria-label="Mozo" className="flex flex-wrap gap-2">
      {opciones.map((o) => (
        <button
          key={o.id ?? 'ninguno'}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          onClick={() => alCambiar(o.id)}
          className={cn(
            'h-10 rounded-full border px-4 text-[14px] font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/25',
            valor === o.id ? 'border-tinta bg-tinta text-white' : 'border-linea bg-superficie hover:border-linea-fuerte',
            o.id === null && valor !== null && 'text-tinta-suave',
          )}
        >
          {o.nombre}
        </button>
      ))}
    </div>
  );
}

/** El primer mozo de la lista, si hay mozos; si no, nadie. */
const mozoPorDefecto = (mozos: Usuario[]) => mozos.find((u) => u.rol === 'mozo')?.id ?? null;

// ───────────────────────── Mesa libre: sentar gente ─────────────────────────

export function PanelLibre({ mesa, salon, alAbierta }: { mesa: Mesa; salon: Salon; alAbierta: () => void }) {
  const [comensales, setComensales] = useState(2);
  const [mozoId, setMozoId] = useState<number | null>(() => mozoPorDefecto(salon.mozos));
  const abrir = useAccionSalon(caja().salon.abrirMesa, { exito: `Mesa ${mesa.nombre} abierta` });
  useEffect(() => {
    setComensales(Math.min(2, mesa.lugares));
    setMozoId(mozoPorDefecto(salon.mozos));
    abrir.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesa.id]);
  const hayMozos = salon.mozos.some((u) => u.rol === 'mozo');

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        // mutateAsync (y no mutate con onSuccess): al refrescarse el salón, la mesa
        // pasa a "ocupada" y este panel desaparece ANTES de que corra un onSuccess
        // propio. La promesa, en cambio, se cumple igual.
        abrir.mutateAsync([{ mesaId: mesa.id, comensales, mozoId }]).then(alAbierta, () => undefined);
      }}
    >
      <div className="border-b border-linea px-5 pt-5 pb-4">
        <p className="text-[13px] font-semibold tracking-wide text-tinta-suave uppercase">Libre · {mesa.lugares} lugares</p>
        <h2 className="font-display text-[34px] leading-none font-semibold tracking-tight">Mesa {mesa.nombre}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">¿Cuántos son?</span>
          <div className="flex items-center gap-3">
            <Contador valor={comensales} alCambiar={setComensales} etiqueta="Personas" />
            {comensales > mesa.lugares && <span className="text-[13px] font-semibold text-[#7a5a00]">Son más que los lugares de la mesa</span>}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">¿Quién los atiende?</span>
          <SelectorMozo mozos={salon.mozos} valor={mozoId} alCambiar={setMozoId} />
          {!hayMozos && <p className="text-[13px] text-tinta-suave">Todavía no hay mozos: el dueño los crea en Ajustes → Usuarios.</p>}
        </div>
        {abrir.error && (
          <p role="alert" className="text-sm font-semibold text-rojo">
            {abrir.error.message}
          </p>
        )}
      </div>
      <div className="border-t border-linea bg-[#fafaf8] px-5 pt-4 pb-5">
        <Button type="submit" size="lg" className="h-14 w-full text-[17px]" disabled={abrir.isPending}>
          <UsersRound /> Sentar {comensales} {comensales === 1 ? 'persona' : 'personas'}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── Mesa ocupada: la cuenta ─────────────────────────

interface PropsCuenta {
  mesa: Mesa;
  salon: Salon;
  ahora: Date;
  alAgregar: () => void;
  alCobrar: (cuenta: PedidoDetalle) => void;
  alLiberada: () => void;
}

export function PanelCuenta({ mesa, salon, ahora, alAgregar, alCobrar, alLiberada }: PropsCuenta) {
  const resumen = mesa.cuenta!;
  const cuenta = useCuenta(resumen.pedidoId);
  const pedirCuenta = useAccionSalon(caja().salon.pedirCuenta);
  const liberar = useAccionSalon(caja().salon.liberar, { exito: `Mesa ${mesa.nombre} liberada` });
  const entregar = useAccionSalon(caja().cocina.cambiarEstado);
  const { imprimir } = useImprimir();
  const [editando, setEditando] = useState(false);
  const p = cuenta.data;
  const vacia = resumen.unidades === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-linea px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn('text-[13px] font-semibold tracking-wide uppercase', mesa.estado === 'cuenta' ? 'text-[#7a5a00]' : 'text-tinta-suave')}>
              {mesa.estado === 'cuenta' ? `Pidió la cuenta ${hace(minutosDesde(resumen.cuentaPedidaEn!, ahora))}` : `Ocupada · ${hace(minutosDesde(resumen.abiertaEn, ahora))}`}
            </p>
            <h2 className="font-display text-[34px] leading-none font-semibold tracking-tight">Mesa {mesa.nombre}</h2>
          </div>
          <span className="numeros pt-1 text-[13px] text-tinta-suave">#{resumen.numero}</span>
        </div>
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="flex w-fit items-center gap-2 rounded-md text-[14px] text-tinta-suave outline-none hover:text-tinta focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          <UsersRound className="size-4" />
          {resumen.comensales ?? '–'} {resumen.comensales === 1 ? 'persona' : 'personas'} · {resumen.mozo ?? 'sin mozo'}
          <Pencil className="size-3.5" />
          <span className="sr-only">Cambiar personas o mozo</span>
        </button>
      </div>

      {/* ── Rondas ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {vacia ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Receipt className="size-9 text-linea-fuerte" strokeWidth={1.5} />
            <p className="font-display text-lg font-semibold">Todavía no pidieron</p>
            <p className="text-sm text-tinta-suave">Cargá el pedido con “Agregar pedido”. Si se fueron sin pedir, liberá la mesa.</p>
            <Button variant="ghost" size="sm" className="mt-1" disabled={liberar.isPending} onClick={() => liberar.mutateAsync([resumen.pedidoId]).then(alLiberada, () => undefined)}>
              <UndoDot /> Liberar mesa
            </Button>
          </div>
        ) : !p ? (
          <p className="p-5 text-sm text-tinta-suave">Cargando la cuenta…</p>
        ) : (
          <ol>
            {p.rondas.map((r) => {
              const items = p.items.filter((i) => i.ronda === r.numero);
              return (
                <li key={r.numero} className="border-b border-linea">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-[#fafaf8] px-5 py-1.5 text-[12px] font-semibold tracking-wide text-tinta-suave uppercase">
                    <span className="flex flex-wrap items-center gap-2">
                      Ronda {r.numero} · {r.hora}
                      <EstadoComandas comandas={p.comandas.filter((c) => c.ronda === r.numero)} alEntregar={(id) => entregar.mutate([id, 'entregada'])} />
                    </span>
                    {items.some((i) => i.vaACocina) && (
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded normal-case outline-none hover:text-tinta focus-visible:ring-2 focus-visible:ring-ring/30"
                        onClick={() => imprimirRonda(resumen.pedidoId, r.numero)}
                      >
                        <Printer className="size-3.5" /> Comanda
                      </button>
                    )}
                  </div>
                  <ul className="divide-y divide-linea/70">
                    {items.map((i) => (
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
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ── Total y acciones ── */}
      <div className="flex flex-col gap-3 border-t border-linea bg-[#fafaf8] px-5 pt-4 pb-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold">Total</span>
          <span className="numeros font-display text-[34px] leading-none font-semibold tracking-tight">{pesos(resumen.totalCentavos)}</span>
        </div>
        {resumen.comensales && resumen.comensales > 1 && resumen.totalCentavos > 0 && (
          <p className="-mt-2 text-right text-[13px] text-tinta-suave">{pesos(Math.ceil(resumen.totalCentavos / resumen.comensales / 100) * 100)} por persona</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" variant={mesa.estado === 'cuenta' ? 'outline' : 'default'} className="col-span-2 h-12" onClick={alAgregar}>
            <Plus /> Agregar pedido
          </Button>
          {mesa.estado === 'cuenta' ? (
            <Button variant="outline" disabled={pedirCuenta.isPending} onClick={() => pedirCuenta.mutate([resumen.pedidoId, false])}>
              <UndoDot /> No era la cuenta
            </Button>
          ) : (
            <Button variant="outline" disabled={vacia || pedirCuenta.isPending} onClick={() => pedirCuenta.mutate([resumen.pedidoId, true])}>
              <BellRing /> Pidió la cuenta
            </Button>
          )}
          <Button variant="outline" disabled={vacia || imprimir.isPending} onClick={() => imprimir.mutate({ id: resumen.pedidoId, tipo: 'ticket' })}>
            <Printer /> Precuenta
          </Button>
          <Button
            size="lg"
            variant={mesa.estado === 'cuenta' ? 'default' : 'oscuro'}
            className="col-span-2 h-14 justify-between text-[17px]"
            disabled={vacia || !p}
            onClick={() => p && alCobrar(p)}
          >
            <span className="flex items-center gap-2">
              <CircleDollarSign /> Cobrar
            </span>
            <span className="numeros font-display">{pesos(resumen.totalCentavos)}</span>
          </Button>
        </div>
      </div>

      <DialogoEditarCuenta
        abierto={editando}
        mesa={mesa}
        salon={salon}
        alCerrar={() => setEditando(false)}
      />
    </div>
  );
}

/** Imprime la comanda de una ronda (con la impresora de Ajustes o el diálogo de Windows). */
export async function imprimirRonda(pedidoId: number, ronda: number) {
  const r = await caja().impresion.ronda(pedidoId, ronda, 'impresora');
  if (!r.ok) toast.error(r.error);
  else if (r.datos.impreso) toast.success(`Comanda de la ronda ${ronda} enviada a la impresora`);
}

function DialogoEditarCuenta({ abierto, mesa, salon, alCerrar }: { abierto: boolean; mesa: Mesa; salon: Salon; alCerrar: () => void }) {
  const c = mesa.cuenta!;
  const [comensales, setComensales] = useState(c.comensales ?? 2);
  const [mozoId, setMozoId] = useState<number | null>(c.mozoId);
  const editar = useAccionSalon(caja().salon.editarCuenta, { exito: 'Mesa actualizada', avisarError: false });
  useEffect(() => {
    if (abierto) {
      setComensales(c.comensales ?? 2);
      setMozoId(c.mozoId);
      editar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);
  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            editar.mutate([c.pedidoId, { comensales, mozoId }], { onSuccess: alCerrar });
          }}
        >
          <DialogHeader>
            <DialogTitle>Mesa {mesa.nombre}</DialogTitle>
            <DialogDescription>Si se sumó alguien o cambió el mozo que los atiende.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Personas</span>
              <Contador valor={comensales} alCambiar={setComensales} etiqueta="Personas" />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Mozo</span>
              <SelectorMozo mozos={salon.mozos} valor={mozoId} alCambiar={setMozoId} />
            </div>
            {editar.error && (
              <p role="alert" className="text-sm font-semibold text-rojo">
                {editar.error.message}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={alCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={editar.isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
