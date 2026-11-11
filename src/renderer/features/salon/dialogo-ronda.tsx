// "Agregar pedido" a una mesa: se arma una RONDA con los mismos productos,
// tamaños y agregados que en Vender, y se manda de una sola vez a la cuenta.
import { useMemo, useRef, useState } from 'react';
import { CircleAlert, Search, Send, ShoppingBag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Menu, Mesa, Producto } from '@compartido/tipos';
import { pesos } from '@compartido/dinero';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { caja } from '@/lib/api';
import { cn, normalizar } from '@/lib/utils';
import { CANTIDAD_MAXIMA, mismoArmado, type ItemCarrito, type NuevoItem } from '@/features/vender/carrito';
import { Contador, DialogoArmar } from '@/features/vender/dialogo-armar';
import { GrillaProductos } from '@/features/vender/grilla-productos';
import { useTotales } from '@/features/vender/totales';
import { useAccionSalon } from './consultas';
import { imprimirRonda } from './panel-mesa';

let contador = 0;
const nuevaClave = () => `ronda-${Date.now()}-${++contador}`;

export function DialogoRonda({ mesa, menu, alCerrar }: { mesa: Mesa; menu: Menu; alCerrar: () => void }) {
  const cuenta = mesa.cuenta!;
  const [items, setItems] = useState<ItemCarrito[]>([]);
  const [categoria, setCategoria] = useState<number | 'todas'>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [armando, setArmando] = useState<{ producto: Producto; editando: ItemCarrito | null } | null>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const totales = useTotales(menu, items, 'mesa', 0);
  const mandar = useAccionSalon(caja().salon.agregarRonda, { avisarError: false });

  const visibles = useMemo(() => {
    const categorias = menu.categorias.filter((c) => c.activa);
    const ids = new Set(categorias.map((c) => c.id));
    return { categorias, productos: menu.productos.filter((p) => ids.has(p.categoriaId)) };
  }, [menu]);
  const texto = normalizar(busqueda.trim());
  const mostrados = texto
    ? visibles.productos.filter((p) => normalizar(`${p.nombre} ${p.codigo}`).includes(texto))
    : visibles.productos.filter((p) => categoria === 'todas' || p.categoriaId === categoria);

  const enfocar = () => setTimeout(() => buscador.current?.focus(), 0);

  function agregar(item: NuevoItem) {
    setItems((actuales) => {
      const igual = actuales.find((i) => mismoArmado(i, item));
      if (igual) return actuales.map((i) => (i.clave === igual.clave ? { ...i, cantidad: Math.min(CANTIDAD_MAXIMA, i.cantidad + item.cantidad) } : i));
      return [...actuales, { ...item, clave: nuevaClave() }];
    });
  }

  function tocar(p: Producto) {
    if (!p.disponible) return;
    if (p.variantes.length === 0 && p.gruposIds.length === 0) {
      agregar({ productoId: p.id, varianteId: null, opcionesIds: [], cantidad: 1, nota: '' });
      enfocar();
    } else setArmando({ producto: p, editando: null });
  }

  function alEnter() {
    const exacto = visibles.productos.find((p) => p.codigo && p.codigo.toLowerCase() === busqueda.trim().toLowerCase());
    const elegido = exacto ?? (mostrados.length === 1 ? mostrados[0] : undefined);
    if (elegido) {
      setBusqueda('');
      tocar(elegido);
    }
  }

  function enviar() {
    mandar.mutate(
      [
        cuenta.pedidoId,
        {
          items: items.map(({ productoId, varianteId, opcionesIds, cantidad, nota }) => ({ productoId, varianteId, opcionesIds, cantidad, nota })),
          totalEsperadoCentavos: totales.totalCentavos,
        },
      ],
      {
        onSuccess: (r) => {
          toast.success(`Ronda ${r.ronda} cargada en la mesa ${mesa.nombre}`, {
            description: `Suma ${pesos(r.rondaCentavos)} · la cuenta va ${pesos(r.totalCentavos)}`,
            action: r.vaACocina ? { label: 'Imprimir comanda', onClick: () => void imprimirRonda(cuenta.pedidoId, r.ronda) } : undefined,
            duration: 8000,
          });
          alCerrar();
        },
      },
    );
  }

  const vacia = items.length === 0;

  return (
    <Dialog open onOpenChange={(a) => !a && !armando && alCerrar()}>
      <DialogContent className="grid h-[88vh] max-w-[1180px] grid-cols-[1fr_380px] gap-0 overflow-hidden p-0">
        {/* ── Productos ── */}
        <section aria-label="Productos" className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-col gap-3 px-6 pt-5 pb-3">
            <div>
              <DialogTitle className="font-display text-2xl font-semibold tracking-tight">Mesa {mesa.nombre} · ronda {cuenta.rondas + 1}</DialogTitle>
              <DialogDescription className="text-sm text-tinta-suave">
                {cuenta.comensales ?? '–'} {cuenta.comensales === 1 ? 'persona' : 'personas'}
                {cuenta.mozo ? ` · atiende ${cuenta.mozo}` : ''}
                {cuenta.totalCentavos > 0 ? ` · la cuenta va ${pesos(cuenta.totalCentavos)}` : ''}
              </DialogDescription>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-tinta-suave" />
              <Input
                ref={buscador}
                autoFocus
                type="search"
                aria-label="Buscar producto o código"
                placeholder="Buscar o escribir el código y Enter"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    alEnter();
                  } else if (e.key === 'Escape' && busqueda) {
                    e.stopPropagation();
                    setBusqueda('');
                  }
                }}
                className="h-12 pr-12 pl-12 text-base [&::-webkit-search-cancel-button]:hidden"
              />
              {busqueda && (
                <button
                  type="button"
                  aria-label="Borrar búsqueda"
                  onClick={() => {
                    setBusqueda('');
                    enfocar();
                  }}
                  className="absolute top-1/2 right-2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-tinta-suave hover:bg-accent"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {!texto && (
              <nav aria-label="Categorías" className="flex flex-wrap gap-2">
                {[{ id: 'todas' as const, nombre: 'Todo' }, ...visibles.categorias].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={categoria === c.id}
                    onClick={() => setCategoria(c.id)}
                    className={cn(
                      'h-9 rounded-full border px-3.5 text-[14px] font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/25',
                      categoria === c.id ? 'border-tinta bg-tinta text-white' : 'border-linea bg-superficie text-tinta hover:border-linea-fuerte',
                    )}
                  >
                    {c.nombre}
                  </button>
                ))}
              </nav>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {mostrados.length > 0 ? (
              <GrillaProductos productos={mostrados} alTocar={tocar} />
            ) : (
              <p className="py-16 text-center text-tinta-suave">Nada coincide con “{busqueda}”.</p>
            )}
          </div>
        </section>

        {/* ── La ronda ── */}
        <aside aria-label="Ronda" className="flex min-h-0 flex-col border-l border-linea bg-superficie">
          <div className="flex items-baseline gap-3 border-b border-linea px-5 pt-6 pr-16 pb-3">
            <h3 className="font-display text-xl font-semibold tracking-tight">Lo que piden ahora</h3>
            {!vacia && <span className="text-[13px] text-tinta-suave">{totales.unidades} {totales.unidades === 1 ? 'producto' : 'productos'}</span>}
          </div>
          {vacia ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
              <ShoppingBag className="size-9 text-linea-fuerte" strokeWidth={1.5} />
              <p className="text-sm text-tinta-suave">Tocá los productos que pidieron.</p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-linea overflow-y-auto">
              {totales.renglones.map(({ item, linea, problema }) => {
                const nombre = linea ? linea.producto.nombre : 'Producto que ya no está';
                return (
                  <li key={item.clave} className={cn('flex gap-3 px-5 py-3', problema && 'bg-rojo-suave/60')}>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <button
                        type="button"
                        className="text-left outline-none focus-visible:underline"
                        disabled={!linea}
                        onClick={() => linea && setArmando({ producto: linea.producto, editando: item })}
                      >
                        <span className="font-semibold">{nombre}</span>
                        {linea?.variante && <span className="text-tinta-suave"> · {linea.variante.nombre}</span>}
                      </button>
                      {linea && linea.agregados.length > 0 && (
                        <p className="text-[13px] leading-snug text-tinta-suave">{linea.agregados.map((a) => a.opcion.nombre).join(' · ')}</p>
                      )}
                      {item.nota && <p className="text-[13px] italic">“{item.nota}”</p>}
                      {problema && <p className="text-[13px] font-semibold text-rojo">{problema}</p>}
                      <div className="mt-1">
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
                    </div>
                    <span className="numeros pt-0.5 font-display text-[16px] font-semibold">{linea ? pesos(linea.totalCentavos) : '—'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-3 border-t border-linea bg-[#fafaf8] px-5 pt-4 pb-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] font-semibold">Esta ronda</span>
              <span className="numeros font-display text-[28px] leading-none font-semibold tracking-tight">{pesos(totales.totalCentavos)}</span>
            </div>
            {(mandar.error || totales.hayProblemas) && (
              <p role="alert" className="flex items-start gap-2 text-[13px] font-semibold text-rojo">
                <CircleAlert className="mt-px size-4 shrink-0" />
                {mandar.error ? mandar.error.message : 'Hay productos que ya no se pueden pedir: quitalos o cambialos.'}
              </p>
            )}
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="outline" size="lg" disabled={vacia} onClick={() => setItems([])} aria-label="Vaciar la ronda" className="px-4">
                <Trash2 />
              </Button>
              <Button size="lg" className="h-14 justify-between text-[17px]" disabled={vacia || totales.hayProblemas || mandar.isPending} onClick={enviar}>
                <span className="flex items-center gap-2">
                  <Send /> Cargar a la mesa
                </span>
                <span className="numeros font-display">{pesos(totales.totalCentavos)}</span>
              </Button>
            </div>
          </div>
        </aside>

        {armando && (
          <DialogoArmar
            menu={menu}
            producto={armando.producto}
            editando={armando.editando}
            alCerrar={() => {
              setArmando(null);
              enfocar();
            }}
            alConfirmar={(item) => {
              if (armando.editando) {
                const clave = armando.editando.clave;
                setItems((actuales) => actuales.map((i) => (i.clave === clave ? { ...item, clave } : i)));
              } else agregar(item);
              setArmando(null);
              enfocar();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
