// Lo que se hace con una cuenta abierta antes de cobrarla: poner la propina,
// dividirla entre varios, pasarla o juntarla con otra mesa, y (el dueño)
// sacar algo con motivo.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightLeft, Combine, Printer, Trash2 } from 'lucide-react';
import { leerPesos, pesos, pesosParaCampo } from '@compartido/dinero';
import { asignadasDeMas, dividirIgual, dividirPorItem, type Asignacion, type ParteDeCuenta } from '@compartido/division';
import type { ItemDetalle, Mesa, ParteImpresa, PedidoDetalle, Salon } from '@compartido/tipos';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { caja } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CampoPesos } from '@/features/caja/campo-pesos';
import { Contador } from '@/features/vender/dialogo-armar';
import { useAccionSalon } from './consultas';

/** Una fila de opciones tipo "botones redondos" (una sola elegida). */
function Opciones<T extends string | number>({
  etiqueta,
  valor,
  opciones,
  alElegir,
}: {
  etiqueta: string;
  valor: T | null;
  opciones: { valor: T; texto: string }[];
  alElegir: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="radio"
          aria-checked={valor === o.valor}
          onClick={() => alElegir(o.valor)}
          className={cn(
            'h-10 rounded-full border px-4 text-[14px] font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/25',
            valor === o.valor ? 'border-tinta bg-tinta text-white' : 'border-linea bg-superficie hover:border-linea-fuerte',
          )}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Propina ─────────────────────────

const PORCENTAJES = [0, 10, 15, 20] as const;
/** El porcentaje del consumo, redondeado a pesos enteros. */
const propinaDe = (consumoCentavos: number, porcentaje: number) => Math.round((consumoCentavos * porcentaje) / 10_000) * 100;

export function DialogoPropina({ abierto, cuenta, alCerrar }: { abierto: boolean; cuenta: PedidoDetalle | undefined; alCerrar: () => void }) {
  const consumo = cuenta?.subtotalCentavos ?? 0;
  const [eleccion, setEleccion] = useState<number | 'otro'>(0);
  const [otro, setOtro] = useState('');
  const guardar = useAccionSalon(caja().salon.fijarPropina, { avisarError: false });

  useEffect(() => {
    if (!abierto || !cuenta) return;
    const actual = cuenta.propinaCentavos;
    const coincide = PORCENTAJES.find((p) => propinaDe(consumo, p) === actual);
    setEleccion(coincide ?? 'otro');
    setOtro(coincide === undefined ? pesosParaCampo(actual) : '');
    guardar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const propina = eleccion === 'otro' ? (otro.trim() === '' ? 0 : leerPesos(otro)) : propinaDe(consumo, eleccion);
  const invalida = propina === null || propina > consumo;

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!cuenta || invalida) return;
            guardar.mutateAsync([cuenta.id, propina!]).then(alCerrar, () => undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>Propina · Mesa {cuenta?.mesa}</DialogTitle>
            <DialogDescription>Se suma al total que se cobra. En los reportes aparece aparte: no es una venta del local.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">¿De cuánto?</span>
              <Opciones<number | 'otro'>
                etiqueta="Propina"
                valor={eleccion}
                opciones={[...PORCENTAJES.map((p) => ({ valor: p, texto: p === 0 ? 'Sin propina' : `${p} %` })), { valor: 'otro' as const, texto: 'Otro monto' }]}
                alElegir={setEleccion}
              />
            </div>
            {eleccion === 'otro' && <CampoPesos etiqueta="Monto de la propina" valor={otro} alCambiar={setOtro} autoFocus chico />}
            <dl className="flex flex-col gap-1.5 rounded-xl bg-secondary px-4 py-3 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-tinta-suave">Consumo</dt>
                <dd className="numeros font-display font-semibold">{pesos(consumo)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tinta-suave">Propina</dt>
                <dd className="numeros font-display font-semibold">{propina === null ? '—' : pesos(propina)}</dd>
              </div>
              <div className="flex justify-between border-t border-linea pt-1.5 text-[17px]">
                <dt className="font-semibold">Total a cobrar</dt>
                <dd className="numeros font-display font-semibold">{invalida ? '—' : pesos(consumo + propina!)}</dd>
              </div>
            </dl>
            {propina !== null && propina > consumo && <p className="text-sm font-semibold text-rojo">La propina no puede ser más que el consumo.</p>}
            {guardar.error && (
              <p role="alert" className="text-sm font-semibold text-rojo">
                {guardar.error.message}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={alCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={invalida || guardar.isPending}>
              Guardar propina
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Dividir la cuenta ─────────────────────────

type Modo = 'iguales' | 'items';
const nombreItem = (i: ItemDetalle) => (i.varianteNombre ? `${i.nombre} ${i.varianteNombre}` : i.nombre);

export function DialogoDividir({
  abierto,
  cuenta,
  comensales,
  alCerrar,
}: {
  abierto: boolean;
  cuenta: PedidoDetalle | undefined;
  comensales: number | null;
  alCerrar: () => void;
}) {
  const [modo, setModo] = useState<Modo>('iguales');
  const [personas, setPersonas] = useState(2);
  /** unidad ("id del renglón:número") → persona (0, 1, 2…). */
  const [reparto, setReparto] = useState<Record<string, number>>({});
  const [imprimiendo, setImprimiendo] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setModo('iguales');
    setPersonas(Math.min(20, Math.max(2, comensales ?? 2)));
    setReparto({});
  }, [abierto, comensales]);

  const items = cuenta?.items ?? [];
  const propina = cuenta?.propinaCentavos ?? 0;
  const consumo = (cuenta?.totalCentavos ?? 0) - propina;

  const resultado = useMemo(() => {
    if (modo === 'iguales') return { partes: dividirIgual(consumo, propina, personas), sinAsignar: 0, deMas: false };
    const asignacion: Asignacion = {};
    for (const i of items) {
      asignacion[i.id] = Array.from({ length: personas }, (_, p) => Array.from({ length: i.cantidad }, (_, k) => reparto[`${i.id}:${k}`]).filter((x) => x === p).length);
    }
    const renglones = items.map((i) => ({ id: i.id, cantidad: i.cantidad, totalCentavos: i.totalCentavos }));
    const d = dividirPorItem(renglones, asignacion, personas, propina);
    return { partes: d.partes, sinAsignar: d.sinAsignar.reduce((s, x) => s + x.unidades, 0), deMas: asignadasDeMas(renglones, asignacion).length > 0 };
  }, [modo, personas, reparto, items, consumo, propina]);

  /** Lo que lleva cada persona, para el papel. */
  function papel(): ParteImpresa[] {
    return resultado.partes.map((p: ParteDeCuenta) => {
      const renglones =
        modo === 'iguales'
          ? [{ texto: `1/${personas} de la cuenta`, montoCentavos: p.consumoCentavos }]
          : items
              .map((i) => {
                const unidades = Array.from({ length: i.cantidad }, (_, k) => reparto[`${i.id}:${k}`]).filter((x) => x === p.persona - 1).length;
                return { texto: `${unidades} × ${nombreItem(i)}`, montoCentavos: Math.round((i.totalCentavos * unidades) / i.cantidad), unidades };
              })
              .filter((r) => r.unidades > 0)
              .map(({ texto, montoCentavos }) => ({ texto, montoCentavos }));
      return { titulo: `Persona ${p.persona}`, renglones, consumoCentavos: p.consumoCentavos, propinaCentavos: p.propinaCentavos, totalCentavos: p.totalCentavos };
    });
  }

  async function imprimir(destino: 'impresora' | 'pdf') {
    if (!cuenta) return;
    setImprimiendo(true);
    const r = await caja().impresion.division(cuenta.id, papel(), destino);
    setImprimiendo(false);
    if (!r.ok) toast.error(r.error);
    else if (r.datos.ruta) toast.success('PDF guardado', { description: r.datos.ruta });
    else if (r.datos.impreso) toast.success('Cuenta dividida enviada a la impresora');
  }

  const falta = modo === 'items' && (resultado.sinAsignar > 0 || resultado.deMas);

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dividir la cuenta · Mesa {cuenta?.mesa}</DialogTitle>
          <DialogDescription>
            Total {pesos(cuenta?.totalCentavos ?? 0)}
            {propina > 0 && ` (con ${pesos(propina)} de propina)`}. Después tocá “Cobrar” y cargá el pago de cada persona con “Pagar con dos medios”.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <Opciones<Modo>
              etiqueta="Cómo dividir"
              valor={modo}
              opciones={[
                { valor: 'iguales', texto: 'Partes iguales' },
                { valor: 'items', texto: 'Cada uno lo suyo' },
              ]}
              alElegir={setModo}
            />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm font-semibold">Personas</span>
              <Contador valor={personas} alCambiar={(n) => setPersonas(Math.min(20, n))} minimo={2} etiqueta="Personas" chico />
            </div>
          </div>

          {modo === 'items' && (
            <div className="flex flex-col gap-1">
              <p className="text-[13px] text-tinta-suave">Tocá a quién le corresponde cada uno.</p>
              <ul className="max-h-[260px] divide-y divide-linea overflow-y-auto rounded-xl border border-linea">
                {items.flatMap((i) =>
                  Array.from({ length: i.cantidad }, (_, k) => {
                    const clave = `${i.id}:${k}`;
                    return (
                      <li key={clave} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                        <span className="min-w-0 flex-1 text-[14px]">
                          <span className="font-semibold">{nombreItem(i)}</span>
                          {i.cantidad > 1 && <span className="text-tinta-suave"> · {k + 1} de {i.cantidad}</span>}
                        </span>
                        <span className="numeros text-[14px] text-tinta-suave">{pesos(Math.round(i.totalCentavos / i.cantidad))}</span>
                        <div role="radiogroup" aria-label={`Quién paga ${nombreItem(i)} ${k + 1}`} className="flex gap-1">
                          {Array.from({ length: personas }, (_, p) => (
                            <button
                              key={p}
                              type="button"
                              role="radio"
                              aria-checked={reparto[clave] === p}
                              onClick={() => setReparto((r) => ({ ...r, [clave]: p }))}
                              className={cn(
                                'size-8 rounded-full border text-[13px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                                reparto[clave] === p ? 'border-tinta bg-tinta text-white' : 'border-linea hover:border-linea-fuerte',
                              )}
                            >
                              {p + 1}
                            </button>
                          ))}
                        </div>
                      </li>
                    );
                  }),
                )}
              </ul>
            </div>
          )}

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Lo que paga cada persona">
            {resultado.partes.map((p) => (
              <li key={p.persona} className="flex flex-col gap-0.5 rounded-xl bg-secondary px-3.5 py-2.5">
                <span className="text-[12px] font-semibold tracking-wide text-tinta-suave uppercase">Persona {p.persona}</span>
                <span className="numeros font-display text-[22px] leading-tight font-semibold">{pesos(p.totalCentavos)}</span>
                {p.propinaCentavos > 0 && <span className="text-[12px] text-tinta-suave">{pesos(p.consumoCentavos)} + {pesos(p.propinaCentavos)} propina</span>}
              </li>
            ))}
          </ul>
          {falta && (
            <p role="status" className="text-sm font-semibold text-[#7a5a00]">
              {resultado.deMas ? 'Hay más unidades repartidas que las de la cuenta.' : `Faltan repartir ${resultado.sinAsignar} ${resultado.sinAsignar === 1 ? 'unidad' : 'unidades'}.`}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={falta || imprimiendo} onClick={() => imprimir('pdf')}>
            Guardar PDF
          </Button>
          <Button type="button" variant="outline" disabled={falta || imprimiendo} onClick={() => imprimir('impresora')}>
            <Printer /> Imprimir
          </Button>
          <Button type="button" onClick={alCerrar}>
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Pasar o juntar mesas ─────────────────────────

export function DialogoMesas({
  abierto,
  mesa,
  salon,
  alCerrar,
  alMovida,
}: {
  abierto: boolean;
  mesa: Mesa;
  salon: Salon;
  alCerrar: () => void;
  /** Después de pasar o juntar, qué mesa mostrar (la de destino). */
  alMovida: (mesaId: number) => void;
}) {
  const pasar = useAccionSalon(caja().salon.pasarMesa, { avisarError: false });
  const juntar = useAccionSalon(caja().salon.juntarMesas, { avisarError: false });
  useEffect(() => {
    if (abierto) {
      pasar.reset();
      juntar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);
  const cuenta = mesa.cuenta!;
  const libres = salon.mesas.filter((m) => m.estado === 'libre');
  const ocupadas = salon.mesas.filter((m) => m.cuenta && m.id !== mesa.id);
  const zona = (id: number) => salon.zonas.find((z) => z.id === id)?.nombre ?? '';
  const error = pasar.error?.message ?? juntar.error?.message;

  const Ficha = ({ m, alElegir, detalle }: { m: Mesa; alElegir: () => void; detalle: string }) => (
    <button
      type="button"
      onClick={alElegir}
      disabled={pasar.isPending || juntar.isPending}
      className="flex min-w-[88px] flex-col items-start rounded-xl border border-linea px-3 py-2 text-left outline-none hover:border-linea-fuerte hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:opacity-50"
    >
      <span className="font-display text-lg leading-tight font-semibold">{m.nombre}</span>
      <span className="text-[12px] text-tinta-suave">{detalle}</span>
    </button>
  );

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mesa {mesa.nombre}: cambiar o juntar</DialogTitle>
          <DialogDescription>Elegí adónde van. Tocá una mesa para confirmar.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ArrowRightLeft className="size-4" /> Se pasan a otra mesa (libre)
            </h3>
            {libres.length === 0 ? (
              <p className="text-[13px] text-tinta-suave">No hay mesas libres.</p>
            ) : (
              <div className="flex max-h-[170px] flex-wrap gap-2 overflow-y-auto">
                {libres.map((m) => (
                  <Ficha
                    key={m.id}
                    m={m}
                    detalle={`${zona(m.zonaId)} · ${m.lugares} lug.`}
                    alElegir={() => pasar.mutateAsync([cuenta.pedidoId, m.id]).then(() => { alMovida(m.id); alCerrar(); toast.success(`La cuenta pasó a la mesa ${m.nombre}`); }, () => undefined)}
                  />
                ))}
              </div>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Combine className="size-4" /> Se juntan con una mesa ocupada
            </h3>
            {ocupadas.length === 0 ? (
              <p className="text-[13px] text-tinta-suave">No hay otras mesas ocupadas.</p>
            ) : (
              <>
                <p className="text-[13px] text-tinta-suave">Lo de esta mesa se suma a la cuenta de la que elijas y esta queda libre.</p>
                <div className="flex max-h-[170px] flex-wrap gap-2 overflow-y-auto">
                  {ocupadas.map((m) => (
                    <Ficha
                      key={m.id}
                      m={m}
                      detalle={`${m.cuenta!.comensales ?? '–'} pers · ${pesos(m.cuenta!.totalCentavos)}`}
                      alElegir={() =>
                        juntar.mutateAsync([cuenta.pedidoId, m.cuenta!.pedidoId]).then(() => { alMovida(m.id); alCerrar(); toast.success(`La mesa ${mesa.nombre} se juntó con la ${m.nombre}`); }, () => undefined)
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </section>
          {error && (
            <p role="alert" className="text-sm font-semibold text-rojo">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Sacar algo (solo el dueño) ─────────────────────────

const MOTIVOS_COMUNES = ['Salió frío', 'Error al cargar', 'El cliente lo canceló', 'Tardó demasiado', 'Cortesía de la casa'];

export function DialogoQuitar({ pedidoId, item, alCerrar }: { pedidoId: number; item: ItemDetalle | null; alCerrar: () => void }) {
  const [cantidad, setCantidad] = useState(1);
  const [motivo, setMotivo] = useState('');
  const quitar = useAccionSalon(caja().salon.quitarItem, { avisarError: false });
  useEffect(() => {
    if (item) {
      setCantidad(item.cantidad);
      setMotivo('');
      quitar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);
  const monto = item ? Math.round((item.totalCentavos * cantidad) / item.cantidad) : 0;

  return (
    <Dialog open={item !== null} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-w-md">
        {item && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              quitar.mutateAsync([pedidoId, { itemId: item.id, cantidad, motivo }]).then((r) => {
                toast.success(`Se sacaron ${pesos(r.montoCentavos)} de la cuenta`);
                alCerrar();
              }, () => undefined);
            }}
          >
            <DialogHeader>
              <DialogTitle>Sacar de la cuenta</DialogTitle>
              <DialogDescription>
                {nombreItem(item)}. Queda anotado con el motivo y se ve en Reportes → Salón.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-5">
              {item.cantidad > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">¿Cuántas de las {item.cantidad}?</span>
                  <Contador valor={cantidad} alCambiar={(n) => setCantidad(Math.min(item.cantidad, n))} etiqueta="Unidades a sacar" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label htmlFor="motivo-quitar" className="text-sm font-semibold">
                  Motivo
                </label>
                <Input id="motivo-quitar" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={140} autoComplete="off" autoFocus placeholder="Por qué se saca" />
                <div className="flex flex-wrap gap-1.5">
                  {MOTIVOS_COMUNES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMotivo(m)}
                      className="h-8 rounded-full border border-linea px-3 text-[13px] outline-none hover:border-linea-fuerte focus-visible:ring-[3px] focus-visible:ring-ring/25"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <p className="rounded-xl bg-secondary px-4 py-2.5 text-[14px]">
                Se restan <span className="numeros font-semibold">{pesos(monto)}</span> de la cuenta. Si había propina, se borra y se vuelve a poner al cobrar.
              </p>
              {quitar.error && (
                <p role="alert" className="text-sm font-semibold text-rojo">
                  {quitar.error.message}
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={alCerrar}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={quitar.isPending || motivo.trim().length < 3}>
                <Trash2 /> Sacar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
