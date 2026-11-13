// Mozos con celular: prender el servidor de la red local y mostrar el QR
// que escanean los mozos para entrar.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, Smartphone } from 'lucide-react';
import { esquemaRed } from '@compartido/esquemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { CodigoQr } from '@/components/qr';
import { caja, desenvolver } from '@/lib/api';

export const CLAVE_RED = ['red'] as const;

export function useEstadoRed() {
  return useQuery({ queryKey: CLAVE_RED, queryFn: () => desenvolver(caja().red.estado()), refetchInterval: 15_000 });
}

export function TarjetaRed() {
  const cliente = useQueryClient();
  const estado = useEstadoRed();
  const [puerto, setPuerto] = useState('3000');
  useEffect(() => {
    if (estado.data) setPuerto(String(estado.data.puerto));
  }, [estado.data?.puerto]); // eslint-disable-line react-hooks/exhaustive-deps

  const configurar = useMutation({
    mutationFn: (datos: { activa: boolean; puerto: number }) => desenvolver(caja().red.configurar(esquemaRed.parse(datos))),
    onSuccess: (r) => {
      cliente.setQueryData(CLAVE_RED, r);
      if (r.error) toast.error(r.error);
      else toast.success(r.funcionando ? 'Listo: los mozos ya pueden entrar desde el celular' : 'Mozos con celular apagado');
    },
    onError: (e) => toast.error(e.message),
  });
  const e = estado.data;
  const numero = Number(puerto);

  return (
    <section className="rounded-xl border border-linea bg-superficie p-5">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-mostaza-suave text-[#7a5a00]">
          <Smartphone className="size-6" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-semibold tracking-tight">Mozos con celular</h2>
            <Switch
              aria-label="Mozos con celular"
              checked={e?.activa ?? false}
              disabled={!e || configurar.isPending}
              onCheckedChange={(activa) => configurar.mutate({ activa, puerto: Number.isInteger(numero) ? numero : 3000 })}
            />
          </div>
          <p className="text-sm text-tinta-suave">Toman los pedidos desde su celular, conectados al mismo wifi que esta PC. No hace falta internet.</p>
        </div>
      </div>

      {e?.error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-rojo-suave px-3 py-2 text-sm font-semibold text-rojo">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {e.error}
        </p>
      )}

      {e?.funcionando && (
        <div className="mt-5 flex flex-col gap-4">
          {e.direcciones.length === 0 ? (
            <p className="text-sm font-semibold text-[#7a5a00]">Esta PC no está conectada a ninguna red. Conectala al wifi (o al cable) del local.</p>
          ) : (
            <ul className="flex flex-wrap gap-6">
              {e.direcciones.map((d) => (
                <li key={d} className="flex items-center gap-4">
                  <CodigoQr texto={d} etiqueta={`Código QR para entrar: ${d}`} />
                  <div className="flex flex-col gap-1">
                    <span className="text-[13px] font-semibold text-tinta-suave">Escaneá con la cámara o escribí:</span>
                    <span className="numeros font-display text-xl font-semibold select-text">{d}</span>
                    <span className="text-[13px] text-tinta-suave">
                      {e.conectados === 0 ? 'Ningún celular conectado' : e.conectados === 1 ? '1 celular conectado' : `${e.conectados} celulares conectados`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-tinta-suave">
            <li>El celular tiene que estar en el wifi del local (el mismo que la PC).</li>
            <li>Escanea el QR y entra con su nombre y su PIN (los mozos se crean en Usuarios, con el rol Mozo).</li>
            <li>
              La primera vez, Windows pregunta si Comandas puede usar la red: marcá <strong>Redes privadas</strong> y tocá <strong>Permitir</strong>.
            </li>
          </ol>
        </div>
      )}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer font-semibold text-tinta-suave">Avanzado: puerto</summary>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            configurar.mutate({ activa: e?.activa ?? false, puerto: numero });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-tinta-suave">Puerto (si el 3000 lo usa otro programa)</span>
            <Input aria-label="Puerto" inputMode="numeric" className="numeros w-32" value={puerto} onChange={(ev) => setPuerto(ev.target.value.replace(/\D/g, '').slice(0, 5))} />
          </label>
          <Button type="submit" variant="outline" disabled={configurar.isPending || String(e?.puerto) === puerto}>
            Guardar puerto
          </Button>
        </form>
      </details>
    </section>
  );
}
