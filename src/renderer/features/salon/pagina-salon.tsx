// Pantalla Salón: el plano de cada zona a la izquierda y, a la derecha, lo
// que pasa en la mesa elegida (o el resumen de todo el salón).
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Lock, Map as Mapa, Move, Plus, Smartphone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { Mesa, PedidoDetalle } from '@compartido/tipos';
import { Button } from '@/components/ui/button';
import { caja } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMenu } from '@/features/menu/consultas';
import { useUsuario } from '@/features/sesion/consultas';
import { useCajaActual } from '@/features/caja/consultas';
import { DialogoAbrirCaja } from '@/features/caja/dialogo-abrir-caja';
import { DialogoCobro } from '@/features/vender/dialogo-cobro';
import { useAccionSalon, useAhora, useSalon } from './consultas';
import { Plano } from './plano';
import { PanelCuenta, PanelLibre, PanelResumen } from './panel-mesa';
import { DialogoRonda } from './dialogo-ronda';
import { DialogoMesa, DialogoZonas } from './dialogos-plano';
import { useEstadoRed } from '@/features/ajustes/tarjeta-red';

export function PaginaSalon() {
  const salon = useSalon();
  const menu = useMenu();
  const ahora = useAhora();
  const { esDueno } = useUsuario();
  const cajaActual = useCajaActual();
  const cajaCerrada = cajaActual.isSuccess && cajaActual.data === null;
  const red = useEstadoRed();

  const [zonaId, setZonaId] = useState<number | null>(null);
  const [elegidaId, setElegidaId] = useState<number | null>(null);
  const [acomodando, setAcomodando] = useState(false);
  const [editandoMesa, setEditandoMesa] = useState<{ mesa: Mesa | null } | null>(null);
  const [zonasAbierto, setZonasAbierto] = useState(false);
  const [rondaPara, setRondaPara] = useState<number | null>(null);
  const [cobrando, setCobrando] = useState<PedidoDetalle | null>(null);
  const [abriendoCaja, setAbriendoCaja] = useState(false);

  const mover = useAccionSalon(caja().salon.moverMesa);
  const cobrar = useAccionSalon(caja().pedidos.cobrar, { avisarError: false });
  const ejemplo = useAccionSalon(caja().salon.cargarEjemplo, {
    exito: (r) =>
      r.mozos.length > 0 ? `Salón de ejemplo listo. Mozos: ${r.mozos.map((m) => `${m.nombre} (PIN ${m.pin})`).join(' y ')}` : 'Salón de ejemplo listo',
  });

  // La zona elegida tiene que existir (si la borraron, vuelve a la primera).
  const zonas = salon.data?.zonas ?? [];
  const zonaActual = zonas.find((z) => z.id === zonaId) ?? zonas[0];
  useEffect(() => {
    if (zonaActual && zonaActual.id !== zonaId) setZonaId(zonaActual.id);
  }, [zonaActual, zonaId]);

  // Escape suelta la mesa elegida (si no hay un diálogo abierto).
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setElegidaId(null);
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, []);

  if (salon.isPending) return <p className="p-10 text-tinta-suave">Cargando el salón…</p>;
  if (salon.isError) return <p className="p-10 text-rojo">No se pudo cargar el salón: {salon.error.message}</p>;
  const datos = salon.data;

  if (datos.mesas.length === 0 && !acomodando) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <Mapa className="size-12 text-linea-fuerte" strokeWidth={1.4} />
        <h1 className="font-display text-3xl font-semibold">Armá tu salón</h1>
        <p className="max-w-md text-tinta-suave">
          {esDueno
            ? 'Cargá las mesas y acomodalas como están en el local. O probá con un salón de ejemplo: 2 zonas, 18 mesas y 2 mozos.'
            : 'El dueño todavía no cargó las mesas del local.'}
        </p>
        {esDueno && (
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => {
                setAcomodando(true);
                setEditandoMesa({ mesa: null });
              }}
            >
              <Plus /> Cargar mis mesas
            </Button>
            <Button variant="outline" disabled={ejemplo.isPending} onClick={() => ejemplo.mutate([])}>
              <Sparkles /> Salón de ejemplo
            </Button>
          </div>
        )}
        {esDueno && (menu.data?.productos.length ?? 0) === 0 && (
          <p className="text-[13px] text-tinta-suave">Tip: si primero cargás el menú de ejemplo (en Vender), el salón de ejemplo trae mesas ocupadas.</p>
        )}
      </div>
    );
  }

  const mesasDeZona = datos.mesas.filter((m) => m.zonaId === zonaActual?.id);
  const elegida = datos.mesas.find((m) => m.id === elegidaId) ?? null;
  const mesaRonda = datos.mesas.find((m) => m.id === rondaPara && m.cuenta) ?? null;
  const conteo = {
    libres: mesasDeZona.filter((m) => m.estado === 'libre').length,
    ocupadas: mesasDeZona.filter((m) => m.estado === 'ocupada').length,
    cuenta: mesasDeZona.filter((m) => m.estado === 'cuenta').length,
  };

  function elegir(mesa: Mesa) {
    setElegidaId(mesa.id);
    if (mesa.zonaId !== zonaActual?.id) setZonaId(mesa.zonaId);
  }

  return (
    <div className="grid h-full grid-cols-[1fr_400px]">
      <section aria-label="Plano del salón" className="flex min-h-0 min-w-0 flex-col">
        {cajaCerrada && !acomodando && (
          <div role="status" className="flex items-center justify-between gap-4 bg-riel px-7 py-3 text-white">
            <span className="flex items-center gap-2.5 font-semibold">
              <Lock className="size-[18px] text-mostaza" /> La caja está cerrada: podés atender mesas, pero para cobrar hay que abrirla.
            </span>
            <Button size="sm" onClick={() => setAbriendoCaja(true)}>
              Abrir caja
            </Button>
          </div>
        )}
        {acomodando && (
          <div role="status" className="flex items-center justify-between gap-4 bg-mostaza-suave px-7 py-3">
            <span className="flex items-center gap-2.5 font-semibold text-[#5c4300]">
              <Move className="size-[18px]" /> Acomodando: arrastrá cada mesa a su lugar. Tocala para cambiarle el nombre, los lugares o la forma.
            </span>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditandoMesa({ mesa: null })}>
                <Plus /> Mesa
              </Button>
              <Button size="sm" variant="outline" onClick={() => setZonasAbierto(true)}>
                Zonas
              </Button>
              <Button size="sm" variant="oscuro" onClick={() => setAcomodando(false)}>
                Listo
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 px-7 pt-5 pb-3">
          <nav aria-label="Zonas" className="flex flex-wrap gap-2">
            {zonas.map((z) => {
              const deLaZona = datos.mesas.filter((m) => m.zonaId === z.id);
              const ocupadas = deLaZona.filter((m) => m.cuenta).length;
              const alguienPide = deLaZona.some((m) => m.estado === 'cuenta');
              return (
                <button
                  key={z.id}
                  type="button"
                  aria-pressed={zonaActual?.id === z.id}
                  onClick={() => setZonaId(z.id)}
                  className={cn(
                    'relative flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/25',
                    zonaActual?.id === z.id ? 'border-tinta bg-tinta text-white' : 'border-linea bg-superficie text-tinta hover:border-linea-fuerte',
                  )}
                >
                  {z.nombre}
                  <span className={cn('numeros text-[13px]', zonaActual?.id === z.id ? 'text-white/70' : 'text-tinta-suave')}>
                    {ocupadas}/{deLaZona.length}
                  </span>
                  {alguienPide && <span aria-label="alguien pidió la cuenta" className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-fondo bg-mostaza" />}
                </button>
              );
            })}
          </nav>
          <div className="flex items-center gap-4">
            {!acomodando && (
              <ul aria-label="Referencias" className="flex items-center gap-3.5 text-[13px] text-tinta-suave">
                <Referencia clase="border-2 border-linea-fuerte bg-superficie" texto={`${conteo.libres} ${conteo.libres === 1 ? 'libre' : 'libres'}`} />
                <Referencia clase="bg-tinta" texto={`${conteo.ocupadas} ${conteo.ocupadas === 1 ? 'ocupada' : 'ocupadas'}`} />
                <Referencia clase="bg-mostaza" texto={`${conteo.cuenta} ${conteo.cuenta === 1 ? 'pide' : 'piden'} la cuenta`} />
              </ul>
            )}
            {red.data?.funcionando && !acomodando && (
              <Chip conectados={red.data.conectados} enlace={esDueno} />
            )}
            {esDueno && !acomodando && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAcomodando(true);
                  setElegidaId(null);
                }}
              >
                <Move /> Acomodar
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-5 pb-5">
          {mesasDeZona.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-linea-fuerte text-center">
              <p className="font-display text-lg font-semibold">{zonaActual?.nombre} no tiene mesas</p>
              {esDueno ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setAcomodando(true);
                    setEditandoMesa({ mesa: null });
                  }}
                >
                  <Plus /> Agregar una mesa
                </Button>
              ) : (
                <p className="text-sm text-tinta-suave">Las carga el dueño.</p>
              )}
            </div>
          ) : (
            <Plano
              mesas={mesasDeZona}
              ahora={ahora}
              elegida={elegidaId}
              acomodando={acomodando}
              alElegir={(m) => setElegidaId(elegidaId === m.id ? null : m.id)}
              alMover={(m, lugar) => mover.mutate([m.id, lugar.x, lugar.y])}
              alEditar={(m) => setEditandoMesa({ mesa: m })}
            />
          )}
        </div>
      </section>

      <aside aria-label={elegida ? `Mesa ${elegida.nombre}` : 'Resumen del salón'} className="flex h-full min-h-0 flex-col border-l border-linea bg-superficie">
        {!elegida || acomodando ? (
          <PanelResumen salon={datos} ahora={ahora} alElegir={elegir} />
        ) : elegida.cuenta ? (
          <PanelCuenta
            key={elegida.cuenta.pedidoId}
            mesa={elegida}
            salon={datos}
            ahora={ahora}
            alAgregar={() => setRondaPara(elegida.id)}
            alCobrar={(c) => setCobrando(c)}
            alLiberada={() => setElegidaId(null)}
          />
        ) : (
          <PanelLibre mesa={elegida} salon={datos} alAbierta={() => setRondaPara(elegida.id)} />
        )}
      </aside>

      {mesaRonda && menu.data && <DialogoRonda key={mesaRonda.id} mesa={mesaRonda} menu={menu.data} alCerrar={() => setRondaPara(null)} />}

      {zonaActual && (
        <DialogoMesa
          abierto={editandoMesa !== null}
          mesa={editandoMesa?.mesa ?? null}
          zonaId={zonaActual.id}
          salon={datos}
          alCerrar={() => setEditandoMesa(null)}
        />
      )}
      <DialogoZonas abierto={zonasAbierto} salon={datos} alCerrar={() => setZonasAbierto(false)} />

      <DialogoCobro
        abierto={cobrando !== null}
        totalCentavos={cobrando?.totalCentavos ?? 0}
        subtitulo={
          cobrando
            ? `Mesa ${cobrando.mesa}${cobrando.comensales ? ` · ${cobrando.comensales} pers.` : ''}${cobrando.mozo ? ` · ${cobrando.mozo}` : ''}`
            : ''
        }
        textoTerminar="Listo"
        cajaCerrada={cajaCerrada}
        alAbrirCaja={() => {
          setCobrando(null);
          setAbriendoCaja(true);
        }}
        alCobrar={(pagos) => cobrar.mutateAsync([cobrando!.id, pagos])}
        alCerrar={() => setCobrando(null)}
        alTerminar={() => {
          const mesa = cobrando?.mesa;
          setCobrando(null);
          setElegidaId(null);
          if (mesa) toast.success(`Mesa ${mesa} cobrada: quedó libre`);
        }}
      />
      <DialogoAbrirCaja abierto={abriendoCaja} alCerrar={() => setAbriendoCaja(false)} />
    </div>
  );
}

function Referencia({ clase, texto }: { clase: string; texto: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-3.5 rounded', clase)} />
      {texto}
    </li>
  );
}

/** Cuántos celulares de mozos están conectados (con link a Ajustes para el dueño). */
function Chip({ conectados, enlace }: { conectados: number; enlace: boolean }) {
  const contenido = (
    <>
      <Smartphone className="size-4" />
      {conectados === 1 ? '1 celular' : `${conectados} celulares`}
    </>
  );
  const clase =
    'flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-semibold text-tinta-suave outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25';
  return enlace ? (
    <Link to="/ajustes" title="Mozos con celular" className={cn(clase, 'hover:text-tinta')}>
      {contenido}
    </Link>
  ) : (
    <span className={clase}>{contenido}</span>
  );
}
