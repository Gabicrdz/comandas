// Diálogos para armar el salón (solo el dueño): una mesa y las zonas.
import { useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { esquemaMesa } from '@compartido/esquemas';
import { FORMAS_MESA, NOMBRE_FORMA, type FormaMesa, type Mesa, type Salon, type Zona } from '@compartido/tipos';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { caja } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Contador } from '@/features/vender/dialogo-armar';
import { Confirmar, type Confirmacion } from '@/features/menu/confirmar';
import { useAccionSalon } from './consultas';

/** El próximo número de mesa libre (si las mesas tienen números). */
function siguienteNombre(mesas: Mesa[]): string {
  const numeros = mesas.map((m) => Number(m.nombre)).filter((n) => Number.isInteger(n));
  return String((numeros.length ? Math.max(...numeros) : 0) + 1);
}

/** Dibujito de la forma de la mesa. */
function Forma({ forma, activa }: { forma: FormaMesa; activa: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block h-7 border-2',
        activa ? 'border-white bg-white/20' : 'border-tinta-suave bg-secondary',
        forma === 'redonda' ? 'w-7 rounded-full' : forma === 'larga' ? 'w-14 rounded-md' : 'w-7 rounded-md',
      )}
    />
  );
}

export function DialogoMesa({
  abierto,
  mesa,
  zonaId,
  salon,
  alCerrar,
}: {
  abierto: boolean;
  /** null = mesa nueva (en la zona `zonaId`). */
  mesa: Mesa | null;
  zonaId: number;
  salon: Salon;
  alCerrar: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [lugares, setLugares] = useState(4);
  const [forma, setForma] = useState<FormaMesa>('cuadrada');
  const [zona, setZona] = useState(zonaId);
  const [error, setError] = useState('');
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const guardar = useAccionSalon(caja().salon.guardarMesa, { exito: mesa ? 'Mesa guardada' : 'Mesa agregada', avisarError: false });
  const baja = useAccionSalon(caja().salon.darDeBajaMesa, { exito: 'Mesa borrada' });

  useEffect(() => {
    if (!abierto) return;
    setNombre(mesa?.nombre ?? siguienteNombre(salon.mesas));
    setLugares(mesa?.lugares ?? 4);
    setForma(mesa?.forma ?? 'cuadrada');
    setZona(mesa?.zonaId ?? zonaId);
    setError('');
    guardar.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  function enviar() {
    const r = esquemaMesa.safeParse({ id: mesa?.id, zonaId: zona, nombre, lugares, forma });
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Revisá los datos.');
      return;
    }
    setError('');
    guardar.mutate([r.data], { onSuccess: alCerrar });
  }

  return (
    <>
      <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
        <DialogContent className="max-w-md">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <DialogHeader>
              <DialogTitle>{mesa ? `Mesa ${mesa.nombre}` : 'Nueva mesa'}</DialogTitle>
              <DialogDescription>{mesa ? 'Para moverla, arrastrala en el plano.' : 'Va al primer lugar libre del plano; después la arrastrás donde está de verdad.'}</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-5">
              <div className="grid grid-cols-[1fr_auto] gap-4">
                <Campo etiqueta="Número o nombre" htmlFor="mesa-nombre" ayuda="Hasta 6 letras: 12, B3, V1…">
                  <Input id="mesa-nombre" autoFocus maxLength={6} value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </Campo>
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">Lugares</span>
                  <Contador valor={lugares} alCambiar={(n) => setLugares(Math.min(30, n))} etiqueta="Lugares" />
                </div>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-semibold">Forma</legend>
                <div role="radiogroup" aria-label="Forma" className="grid grid-cols-3 gap-2">
                  {FORMAS_MESA.map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={forma === f}
                      onClick={() => setForma(f)}
                      className={cn(
                        'flex h-[84px] flex-col items-center justify-center gap-2 rounded-lg border text-[14px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                        forma === f ? 'border-tinta bg-tinta text-white' : 'border-linea hover:border-linea-fuerte',
                      )}
                    >
                      <Forma forma={f} activa={forma === f} />
                      {NOMBRE_FORMA[f]}
                    </button>
                  ))}
                </div>
                <p className="text-[13px] text-tinta-suave">La larga ocupa dos lugares del plano.</p>
              </fieldset>
              {salon.zonas.length > 1 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-semibold">Zona</legend>
                  <div role="radiogroup" aria-label="Zona" className="flex flex-wrap gap-2">
                    {salon.zonas.map((z) => (
                      <button
                        key={z.id}
                        type="button"
                        role="radio"
                        aria-checked={zona === z.id}
                        onClick={() => setZona(z.id)}
                        className={cn(
                          'h-10 rounded-full border px-4 text-[14px] font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                          zona === z.id ? 'border-tinta bg-tinta text-white' : 'border-linea hover:border-linea-fuerte',
                        )}
                      >
                        {z.nombre}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {(error || guardar.error) && (
                <p role="alert" className="text-sm font-semibold text-rojo">
                  {error || guardar.error?.message}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="justify-between">
              {mesa ? (
                <Button
                  type="button"
                  variant="ghost-destructive"
                  disabled={mesa.estado !== 'libre'}
                  title={mesa.estado !== 'libre' ? 'Tiene una cuenta abierta' : undefined}
                  onClick={() =>
                    setConfirmacion({
                      titulo: `¿Borrar la mesa ${mesa.nombre}?`,
                      descripcion: 'Deja de aparecer en el plano. Las cuentas que ya tuvo quedan guardadas.',
                      boton: 'Borrar mesa',
                      alConfirmar: () => baja.mutate([mesa.id], { onSuccess: alCerrar }),
                    })
                  }
                >
                  <Trash2 /> Borrar
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={alCerrar}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={guardar.isPending}>
                  {mesa ? 'Guardar' : 'Agregar mesa'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Confirmar confirmacion={confirmacion} alCerrar={() => setConfirmacion(null)} />
    </>
  );
}

export function DialogoZonas({ abierto, salon, alCerrar }: { abierto: boolean; salon: Salon; alCerrar: () => void }) {
  const [nueva, setNueva] = useState('');
  const [editando, setEditando] = useState<{ id: number; nombre: string } | null>(null);
  const guardar = useAccionSalon(caja().salon.guardarZona, { avisarError: false });
  const baja = useAccionSalon(caja().salon.darDeBajaZona, { exito: 'Zona borrada' });
  useEffect(() => {
    if (abierto) {
      setNueva('');
      setEditando(null);
      guardar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);
  const mesasDe = (z: Zona) => salon.mesas.filter((m) => m.zonaId === z.id).length;

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Zonas del local</DialogTitle>
          <DialogDescription>Cada zona tiene su plano: Salón, Vereda, Patio, Planta alta…</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <ul className="divide-y divide-linea rounded-lg border border-linea">
            {salon.zonas.map((z) =>
              editando?.id === z.id ? (
                <li key={z.id}>
                  <form
                    className="flex items-center gap-2 px-3 py-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      guardar.mutate([{ id: z.id, nombre: editando.nombre }], { onSuccess: () => setEditando(null) });
                    }}
                  >
                    <Input autoFocus aria-label="Nombre de la zona" maxLength={24} value={editando.nombre} onChange={(e) => setEditando({ id: z.id, nombre: e.target.value })} className="h-10" />
                    <Button type="submit" size="icon-sm" aria-label="Guardar nombre" disabled={guardar.isPending}>
                      <Check />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditando(null)}>
                      <X />
                    </Button>
                  </form>
                </li>
              ) : (
                <li key={z.id} className="flex items-center gap-2 px-4 py-2.5">
                  <span className="flex-1 font-semibold">{z.nombre}</span>
                  <span className="text-[13px] text-tinta-suave">
                    {mesasDe(z)} {mesasDe(z) === 1 ? 'mesa' : 'mesas'}
                  </span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Renombrar ${z.nombre}`} onClick={() => setEditando({ id: z.id, nombre: z.nombre })}>
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Borrar ${z.nombre}`}
                    disabled={salon.zonas.length === 1 || mesasDe(z) > 0}
                    title={mesasDe(z) > 0 ? 'Primero pasá o borrá sus mesas' : undefined}
                    onClick={() => baja.mutate([z.id])}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ),
            )}
          </ul>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              guardar.mutate([{ nombre: nueva }], { onSuccess: () => setNueva('') });
            }}
          >
            <Campo etiqueta="Zona nueva" htmlFor="zona-nueva" className="flex-1">
              <Input id="zona-nueva" placeholder="Por ejemplo: Patio" maxLength={24} value={nueva} onChange={(e) => setNueva(e.target.value)} />
            </Campo>
            <Button type="submit" variant="outline" disabled={!nueva.trim() || guardar.isPending}>
              <Plus /> Agregar
            </Button>
          </form>
          {guardar.error && (
            <p role="alert" className="text-sm font-semibold text-rojo">
              {guardar.error.message}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={alCerrar}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
