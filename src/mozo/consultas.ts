// Datos del celular con TanStack Query (igual que en la PC) + los avisos en
// vivo por SSE: cuando la PC avisa un cambio, se vuelven a pedir los datos.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Cambio, IngresoMozo, Menu, PedidoDetalle, RondaAgregada, Salon, Usuario } from '@compartido/tipos';
import type { DatosRonda } from '@compartido/esquemas';
import { pedir, tokenGuardado } from './api';
import { conectarEventos } from './eventos';

export const useHola = () => useQuery({ queryKey: ['hola'], queryFn: () => pedir<{ local: string }>('/api/hola') });
export const useEquipo = () => useQuery({ queryKey: ['equipo'], queryFn: () => pedir<Usuario[]>('/api/equipo') });

// Por si un aviso se pierde (el celular estuvo bloqueado), igual se refresca cada 30 s.
export const useSalon = () => useQuery({ queryKey: ['salon'], queryFn: () => pedir<Salon>('/api/salon'), refetchInterval: 30_000 });
export const useMenu = () => useQuery({ queryKey: ['menu'], queryFn: () => pedir<Menu>('/api/menu') });
export const useCuenta = (pedidoId: number | null) =>
  useQuery({
    queryKey: ['cuenta', pedidoId],
    queryFn: () => pedir<PedidoDetalle>(`/api/cuentas/${pedidoId}`),
    enabled: pedidoId !== null,
    refetchInterval: 30_000,
  });

export function useIngresar() {
  return useMutation({ mutationFn: (datos: { usuarioId: number; pin: string }) => pedir<IngresoMozo>('/api/ingresar', datos) });
}

/** Acción que cambia algo: al terminar, se refrescan el salón y la cuenta. */
function useCambio<A, R>(fn: (a: A) => Promise<R>) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all([cliente.invalidateQueries({ queryKey: ['salon'] }), cliente.invalidateQueries({ queryKey: ['cuenta'] })]),
  });
}

export const useAbrirMesa = () => useCambio(({ mesaId, comensales }: { mesaId: number; comensales: number }) => pedir<number>(`/api/mesas/${mesaId}/abrir`, { comensales }));
export const useMandarRonda = () =>
  useCambio(({ pedidoId, datos }: { pedidoId: number; datos: DatosRonda }) => pedir<RondaAgregada>(`/api/cuentas/${pedidoId}/rondas`, datos));
export const usePedirCuenta = () =>
  useCambio(({ pedidoId, pedida }: { pedidoId: number; pedida: boolean }) => pedir<null>(`/api/cuentas/${pedidoId}/cuenta`, { pedida }));

/**
 * Se conecta a /api/eventos (Server-Sent Events). EventSource se reconecta
 * solo si se corta el wifi; mientras tanto mostramos "Sin conexión".
 */
/** Un aviso fuerte en el celular: vibra y muestra el cartel. */
function avisarAlMozo(texto: string, detalle?: string): void {
  navigator.vibrate?.([120, 60, 120]);
  toast.success(texto, { description: detalle, duration: 10_000 });
}

export function useEventos(activo: boolean, yoId?: number): boolean {
  const cliente = useQueryClient();
  const [conectado, setConectado] = useState(true);
  useEffect(() => {
    const token = tokenGuardado();
    if (!activo || !token) return;
    return conectarEventos({
      token,
      alConectar: () => void cliente.invalidateQueries(), // al reconectar, todo puede haber cambiado
      alCambio: (aviso) => {
        const cambio = aviso as Cambio;
        // Lo que la cocina o la barra terminó para MIS mesas: hay que ir a buscarlo.
        if (cambio.tipo === 'comanda' && cambio.estado === 'lista' && cambio.mesa && cambio.mozoId === yoId) {
          avisarAlMozo(`Mesa ${cambio.mesa}: ${cambio.sector === 'barra' ? 'la barra' : 'la cocina'} ya lo tiene listo`, `Ronda ${cambio.ronda} · andá a buscarlo`);
        }
        if (cambio.tipo === 'menu') void cliente.invalidateQueries({ queryKey: ['menu'] });
        else {
          void cliente.invalidateQueries({ queryKey: ['salon'] });
          void cliente.invalidateQueries({ queryKey: ['cuenta'] });
        }
      },
      alEstado: setConectado,
      alPerderla: () => void pedir('/api/yo').catch(() => undefined), // si la sesión venció, vuelve al ingreso
    });
  }, [activo, cliente, yoId]);
  return conectado;
}

/** El mozo llevó a la mesa lo que estaba listo. */
export const useEntregarComanda = () => useCambio((comandaId: number) => pedir<null>(`/api/comandas/${comandaId}/entregada`, {}));
