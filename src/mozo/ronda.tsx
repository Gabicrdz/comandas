// Cargar una ronda desde el celular: lista de productos por categoría (en una
// pantalla chica una lista se toca mejor que una grilla), el armado con
// tamaños y agregados (el mismo diálogo de la PC) y la barra de abajo para
// revisar y mandar.
import { useMemo, useState } from 'react';
import { ChevronUp, Search, Send, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Producto } from '@compartido/tipos';
import { pesos } from '@compartido/dinero';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn, normalizar } from '@/lib/utils';
import { CANTIDAD_MAXIMA, mismoArmado, type ItemCarrito, type NuevoItem } from '@/features/vender/carrito';
import { Contador, DialogoArmar } from '@/features/vender/dialogo-armar';
import { useTotales } from '@/features/vender/totales';
import { useMandarRonda, useMenu, useSalon } from './consultas';

let contador = 0;

export function PantallaRonda({ mesaId, alTerminar }: { mesaId: number; alTerminar: () => void }) {
  const salon = useSalon();
  const menu = useMenu();
  const mandar = useMandarRonda();
  const mesa = salon.data?.mesas.find((m) => m.id === mesaId);
  const [items, setItems] = useState<ItemCarrito[]>([]);
  const [categoria, setCategoria] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [armando, setArmando] = useState<{ producto: Producto; editando: ItemCarrito | null } | null>(null);
  const [revisando, setRevisando] = useState(false);
  const totales = useTotales(menu.data, items, 'mesa', 0);

  const visibles = useMemo(() => {
    if (!menu.data) return { categorias: [], productos: [] };
    const categorias = menu.data.categorias.filter((c) => c.activa);
    const ids = new Set(categorias.map((c) => c.id));
    return { categorias, productos: menu.data.productos.filter((p) => ids.has(p.categoriaId)) };
  }, [menu.data]);

  if (menu.isPending || salon.isPending) return <p className="p-6 text-tinta-suave">Cargando el menú…</p>;
  if (menu.isError) return <p className="p-6 text-rojo">{menu.error.message}</p>;
  if (!mesa?.cuenta) return <p className="p-6 text-tinta-suave">La mesa ya no tiene una cuenta abierta.</p>;
  const cuenta = mesa.cuenta;

  const texto = normalizar(busqueda.trim());
  const categoriaActual = categoria ?? visibles.categorias[0]?.id ?? null;
  const mostrados = texto
    ? visibles.productos.filter((p) => normalizar(`${p.nombre} ${p.codigo}`).includes(texto))
    : visibles.productos.filter((p) => p.categoriaId === categoriaActual);
  const cantidadDe = (productoId: number) => items.filter((i) => i.productoId === productoId).reduce((s, i) => s + i.cantidad, 0);

  function agregar(item: NuevoItem) {
    setItems((actuales) => {
      const igual = actuales.find((i) => mismoArmado(i, item));
      if (igual) return actuales.map((i) => (i.clave === igual.clave ? { ...i, cantidad: Math.min(CANTIDAD_MAXIMA, i.cantidad + item.cantidad) } : i));
      return [...actuales, { ...item, clave: `c${++contador}` }];
    });
  }

  function tocar(p: Producto) {
    if (!p.disponible) return;
    if (p.variantes.length === 0 && p.gruposIds.length === 0) {
      agregar({ productoId: p.id, varianteId: null, opcionesIds: [], cantidad: 1, nota: '' });
      navigator.vibrate?.(15); // un "toque" corto para confirmar
    } else setArmando({ producto: p, editando: null });
  }

  function enviar() {
    mandar.mutate(
      {
        pedidoId: cuenta.pedidoId,
        datos: {
          items: items.map(({ productoId, varianteId, opcionesIds, cantidad, nota }) => ({ productoId, varianteId, opcionesIds, cantidad, nota })),
          totalEsperadoCentavos: totales.totalCentavos,
        },
      },
      {
        onSuccess: (r) => {
          toast.success(`Ronda ${r.ronda} mandada a la mesa ${mesa!.nombre}`, { description: `La cuenta va ${pesos(r.totalCentavos)}` });
          setRevisando(false);
          alTerminar();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-linea bg-superficie px-4 pt-3 pb-2">
        <p className="text-[13px] font-semibold text-tinta-suave">
          Mesa {mesa.nombre} · ronda {cuenta.rondas + 1} · {cuenta.comensales ?? '–'} pers.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-tinta-suave" />
          <Input
            type="search"
            aria-label="Buscar producto"
            placeholder="Buscar o código"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-11 pr-11 pl-11 text-base [&::-webkit-search-cancel-button]:hidden"
          />
          {busqueda && (
            <button type="button" aria-label="Borrar búsqueda" onClick={() => setBusqueda('')} className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center text-tinta-suave">
              <X className="size-4" />
            </button>
          )}
        </div>
        {!texto && (
          <nav aria-label="Categorías" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {visibles.categorias.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={categoriaActual === c.id}
                onClick={() => setCategoria(c.id)}
                className={cn(
                  'h-9 shrink-0 rounded-full border px-3.5 text-[14px] font-semibold whitespace-nowrap',
                  categoriaActual === c.id ? 'border-tinta bg-tinta text-white' : 'border-linea bg-superficie',
                )}
              >
                {c.nombre}
              </button>
            ))}
          </nav>
        )}
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-linea overflow-y-auto bg-superficie">
        {mostrados.map((p) => {
          const n = cantidadDe(p.id);
          const opciones = p.variantes.length > 0 || p.gruposIds.length > 0;
          const precio = p.variantes.length > 0 ? `desde ${pesos(Math.min(...p.variantes.map((v) => v.precioCentavos)))}` : pesos(p.precioCentavos);
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={!p.disponible}
                onClick={() => tocar(p)}
                aria-label={`${p.nombre}, ${p.disponible ? precio : 'agotado'}${n ? `, ${n} en la ronda` : ''}`}
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{p.nombre}</span>
                  <span className="flex items-center gap-1.5 text-[13px] text-tinta-suave">
                    {p.disponible ? precio : 'Agotado'}
                    {opciones && p.disponible && <SlidersHorizontal className="size-3.5" aria-hidden="true" />}
                  </span>
                </span>
                {n > 0 && <span className="numeros flex size-8 items-center justify-center rounded-full bg-mostaza font-display font-semibold">{n}</span>}
              </button>
            </li>
          );
        })}
        {mostrados.length === 0 && <li className="px-5 py-10 text-center text-tinta-suave">Nada coincide con “{busqueda}”.</li>}
      </ul>

      {/* ── Barra de abajo: revisar y mandar ── */}
      <div className="border-t border-linea bg-superficie px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {items.length === 0 ? (
          <p className="py-3 text-center text-sm text-tinta-suave">Tocá lo que piden. Después lo mandás de una.</p>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button variant="outline" size="lg" className="h-14" onClick={() => setRevisando(true)}>
              <ChevronUp /> {totales.unidades}
            </Button>
            <Button size="lg" className="h-14 justify-between text-[17px]" disabled={totales.hayProblemas || mandar.isPending} onClick={enviar}>
              <span className="flex items-center gap-2">
                <Send /> Mandar
              </span>
              <span className="numeros font-display">{pesos(totales.totalCentavos)}</span>
            </Button>
          </div>
        )}
      </div>

      {/* ── Revisar la ronda antes de mandarla ── */}
      <Dialog open={revisando} onOpenChange={setRevisando}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mesa {mesa.nombre} · ronda {cuenta.rondas + 1}</DialogTitle>
            <DialogDescription>Tocá un producto para cambiarlo.</DialogDescription>
          </DialogHeader>
          <DialogBody className="p-0">
            <ul className="divide-y divide-linea">
              {totales.renglones.map(({ item, linea, problema }) => {
                const nombre = linea ? linea.producto.nombre : 'Producto que ya no está';
                return (
                  <li key={item.clave} className={cn('flex gap-3 px-6 py-3', problema && 'bg-rojo-suave/60')}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <button type="button" className="text-left" disabled={!linea} onClick={() => linea && setArmando({ producto: linea.producto, editando: item })}>
                        <span className="font-semibold">{nombre}</span>
                        {linea?.variante && <span className="text-tinta-suave"> · {linea.variante.nombre}</span>}
                      </button>
                      {linea && linea.agregados.length > 0 && <p className="text-[13px] text-tinta-suave">{linea.agregados.map((a) => a.opcion.nombre).join(' · ')}</p>}
                      {item.nota && <p className="text-[13px] italic">“{item.nota}”</p>}
                      {problema && <p className="text-[13px] font-semibold text-rojo">{problema}</p>}
                      <Contador
                        chico
                        minimo={0}
                        valor={item.cantidad}
                        etiqueta={nombre}
                        alCambiar={(n) =>
                          setItems((actuales) =>
                            n <= 0 ? actuales.filter((i) => i.clave !== item.clave) : actuales.map((i) => (i.clave === item.clave ? { ...i, cantidad: n } : i)),
                          )
                        }
                      />
                    </div>
                    <span className="numeros font-display font-semibold">{linea ? pesos(linea.totalCentavos) : '—'}</span>
                  </li>
                );
              })}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button className="h-12 w-full justify-between text-base" disabled={items.length === 0 || totales.hayProblemas || mandar.isPending} onClick={enviar}>
              <span className="flex items-center gap-2">
                <Send /> Mandar
              </span>
              <span className="numeros font-display">{pesos(totales.totalCentavos)}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {armando && menu.data && (
        <DialogoArmar
          menu={menu.data}
          producto={armando.producto}
          editando={armando.editando}
          alCerrar={() => setArmando(null)}
          alConfirmar={(item) => {
            if (armando.editando) {
              const clave = armando.editando.clave;
              setItems((actuales) => actuales.map((i) => (i.clave === clave ? { ...item, clave } : i)));
            } else agregar(item);
            setArmando(null);
          }}
        />
      )}
    </div>
  );
}
