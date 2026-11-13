// Pantalla de cocina y barra: el PIN con el que entran y cómo abrirla
// (en una tablet escaneando el QR, o en otra ventana de esta PC).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChefHat, Check, MonitorUp } from 'lucide-react';
import { esquemaPinCocina } from '@compartido/esquemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodigoQr } from '@/components/qr';
import { caja, desenvolver } from '@/lib/api';
import { useEstadoRed } from './tarjeta-red';

export function TarjetaCocina() {
  const cliente = useQueryClient();
  const red = useEstadoRed();
  const configuracion = useQuery({ queryKey: ['configuracion'], queryFn: () => desenvolver(caja().configuracion.obtener()) });
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const guardar = useMutation({
    mutationFn: (nuevo: string) => desenvolver(caja().cocina.cambiarPin(nuevo)),
    onSuccess: () => {
      setPin('');
      toast.success('PIN de cocina guardado');
      void cliente.invalidateQueries({ queryKey: ['configuracion'] });
    },
    onError: (e) => setError(e.message),
  });
  const abrir = useMutation({ mutationFn: () => desenvolver(caja().cocina.abrirVentana()), onError: (e) => toast.error(e.message) });
  const hayPin = configuracion.data?.hayPinCocina ?? false;
  const direccion = red.data?.funcionando ? red.data.direcciones[0] : undefined;

  return (
    <section className="rounded-xl border border-linea bg-superficie p-5">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-tinta">
          <ChefHat className="size-6" />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-xl font-semibold tracking-tight">Pantalla de cocina y barra</h2>
          <p className="text-sm text-tinta-suave">
            La cocina ve lo que tiene que preparar apenas el mozo lo carga, y avisa cuando está listo. Funciona en una tablet, en otra PC o en un segundo monitor.
          </p>
        </div>
      </div>

      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const r = esquemaPinCocina.safeParse({ pin });
          if (!r.success) {
            setError(r.error.issues[0]?.message ?? 'Revisá el PIN.');
            return;
          }
          setError('');
          guardar.mutate(r.data.pin);
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">
            PIN de cocina{' '}
            {hayPin ? (
              <span className="ml-1 inline-flex items-center gap-1 font-normal text-verde">
                <Check className="size-3.5" /> ya elegido
              </span>
            ) : (
              <span className="ml-1 font-normal text-[#7a5a00]">(todavía no hay)</span>
            )}
          </span>
          <Input
            aria-label="PIN de cocina"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder={hayPin ? 'Nuevo PIN' : '4 a 6 números'}
            className="numeros w-40"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </label>
        <Button type="submit" variant="outline" disabled={!pin || guardar.isPending}>
          {hayPin ? 'Cambiar PIN' : 'Guardar PIN'}
        </Button>
        {error && (
          <p role="alert" className="w-full text-sm font-semibold text-rojo">
            {error}
          </p>
        )}
      </form>

      {!red.data?.funcionando ? (
        <p className="mt-4 text-sm text-tinta-suave">Para abrir la pantalla, primero prendé “Mozos con celular”: usa el mismo servidor de la red del local.</p>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-6">
          {direccion && (
            <div className="flex items-center gap-4">
              <CodigoQr texto={`${direccion}/cocina`} tamano={132} etiqueta={`Código QR de la pantalla de cocina: ${direccion}/cocina`} />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-tinta-suave">En una tablet o en otra PC, abrí:</span>
                <span className="numeros font-display text-lg font-semibold select-text">{direccion}/cocina</span>
              </div>
            </div>
          )}
          <Button variant="outline" disabled={abrir.isPending} onClick={() => abrir.mutate()}>
            <MonitorUp /> Abrir en esta PC (otra ventana)
          </Button>
        </div>
      )}
    </section>
  );
}
