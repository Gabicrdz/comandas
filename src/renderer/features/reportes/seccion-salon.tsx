// Reportes del salón: cómo le fue a cada mozo, cuánto tarda la cocina y la
// barra, y qué se sacó de las cuentas (con quién y por qué).
import { pesos } from '@compartido/dinero';
import { LIMITE_TARDE_MIN, NOMBRE_SECTOR, type ReporteSalon } from '@compartido/tipos';
import { cn } from '@/lib/utils';
import { useReporteSalon } from './consultas';
import type { Rango } from './rangos';

/** 125 → "2 min 5 s" · 40 → "40 s" · null → "—". */
export function tiempo(segundos: number | null): string {
  if (segundos === null) return '—';
  if (segundos < 60) return `${segundos} s`;
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s === 0 || m >= 10 ? `${m} min` : `${m} min ${s} s`;
}

export function SeccionSalon({ rango }: { rango: Rango }) {
  const consulta = useReporteSalon(rango);
  const r = consulta.data;
  if (consulta.isError) return <p role="alert" className="font-semibold text-rojo">{consulta.error.message}</p>;
  if (!r) return <p className="text-tinta-suave">Cargando…</p>;
  return (
    <div className={cn('flex flex-col gap-5 transition-opacity', consulta.isPlaceholderData && 'opacity-60')}>
      <Mozos r={r} />
      <Cocina r={r} />
      <Quitados r={r} />
    </div>
  );
}

function Tarjeta({ titulo, descripcion, children }: { titulo: string; descripcion: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-linea bg-superficie p-5">
      <header>
        <h2 className="font-display text-lg font-semibold tracking-tight">{titulo}</h2>
        <p className="text-[13px] text-tinta-suave">{descripcion}</p>
      </header>
      {children}
    </section>
  );
}

const Vacio = ({ texto }: { texto: string }) => <p className="py-6 text-center text-tinta-suave">{texto}</p>;

function Mozos({ r }: { r: ReporteSalon }) {
  return (
    <Tarjeta titulo="Mozos" descripcion="Cuentas de mesa ya cobradas. Las ventas no incluyen la propina.">
      {r.mozos.length === 0 ? (
        <Vacio texto="Todavía no se cobró ninguna mesa en este período." />
      ) : (
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-linea text-left text-[13px] text-tinta-suave">
              <th className="py-2 font-semibold">Mozo</th>
              <th className="py-2 text-right font-semibold">Cuentas</th>
              <th className="py-2 text-right font-semibold">Personas</th>
              <th className="py-2 text-right font-semibold">Ventas</th>
              <th className="py-2 text-right font-semibold">Promedio por mesa</th>
              <th className="py-2 text-right font-semibold">Por persona</th>
              <th className="py-2 text-right font-semibold">Propinas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea">
            {r.mozos.map((m) => (
              <tr key={m.mozoId ?? 'ninguno'}>
                <th scope="row" className="py-2.5 text-left font-semibold">{m.nombre}</th>
                <td className="numeros py-2.5 text-right">{m.cuentas}</td>
                <td className="numeros py-2.5 text-right">{m.comensales}</td>
                <td className="numeros py-2.5 text-right font-semibold">{pesos(m.ventasCentavos)}</td>
                <td className="numeros py-2.5 text-right">{pesos(m.ticketPromedioCentavos)}</td>
                <td className="numeros py-2.5 text-right">{m.porPersonaCentavos ? pesos(m.porPersonaCentavos) : '—'}</td>
                <td className="numeros py-2.5 text-right">{m.propinasCentavos ? pesos(m.propinasCentavos) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tarjeta>
  );
}

function Cocina({ r }: { r: ReporteSalon }) {
  return (
    <Tarjeta
      titulo="Cocina y barra"
      descripcion={`Promedio de lo que tarda cada comanda. “Tarde” = más de ${LIMITE_TARDE_MIN} minutos desde que entró hasta que quedó lista.`}
    >
      {r.cocina.every((c) => c.comandas === 0) ? (
        <Vacio texto="No hubo comandas en este período." />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {r.cocina.map((c) => (
            <div key={c.sector} className="flex flex-col gap-3 rounded-xl bg-secondary px-4 py-3.5">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-[17px] font-semibold">{NOMBRE_SECTOR[c.sector]}</h3>
                <span className="text-[13px] text-tinta-suave">{c.comandas} {c.comandas === 1 ? 'comanda' : 'comandas'}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[14px]">
                <Dato titulo="Hasta que la empiezan" valor={tiempo(c.esperaSeg)} />
                <Dato titulo="Preparación" valor={tiempo(c.preparacionSeg)} />
                <Dato titulo="Total hasta estar lista" valor={tiempo(c.totalSeg)} fuerte />
                <Dato titulo="Hasta que la llevan" valor={tiempo(c.entregaSeg)} />
              </dl>
              <p className={cn('text-[13px] font-semibold', c.tardias > 0 ? 'text-[#7a5a00]' : 'text-tinta-suave')}>
                {c.tardias === 0 ? 'Ninguna salió tarde' : `${c.tardias} ${c.tardias === 1 ? 'salió tarde' : 'salieron tarde'} (${Math.round((c.tardias / c.comandas) * 100)} %)`}
              </p>
            </div>
          ))}
        </div>
      )}
    </Tarjeta>
  );
}

function Dato({ titulo, valor, fuerte = false }: { titulo: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[12px] text-tinta-suave">{titulo}</dt>
      <dd className={cn('numeros font-display text-[19px] leading-tight', fuerte ? 'font-semibold' : 'font-medium')}>{valor}</dd>
    </div>
  );
}

function Quitados({ r }: { r: ReporteSalon }) {
  const q = r.quitados;
  return (
    <Tarjeta
      titulo="Sacado de las cuentas"
      descripcion={q.unidades ? `${q.unidades} ${q.unidades === 1 ? 'unidad' : 'unidades'} · ${pesos(q.montoCentavos)}. Solo el dueño puede sacar cosas y siempre con un motivo.` : 'Solo el dueño puede sacar cosas de una cuenta y siempre con un motivo.'}
    >
      {q.lista.length === 0 ? (
        <Vacio texto="No se sacó nada de las cuentas en este período." />
      ) : (
        <ul className="divide-y divide-linea">
          {q.lista.map((x) => (
            <li key={x.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-[15px]">
              <span className="numeros w-[104px] text-[13px] text-tinta-suave">{x.creadoEn.slice(8, 10)}/{x.creadoEn.slice(5, 7)} {x.creadoEn.slice(11, 16)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{x.cantidad}× {x.nombre}</span>
                <span className="text-tinta-suave"> · Mesa {x.mesa} · “{x.motivo}”{x.usuario ? ` · ${x.usuario}` : ''}</span>
              </span>
              <span className="numeros font-semibold">{pesos(x.montoCentavos)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
