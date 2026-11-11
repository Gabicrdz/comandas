// Datos del salón con TanStack Query. El plano se vuelve a pedir solo cada
// 10 segundos (para que los minutos y lo que cargó otro se vean al día).
// En la etapa 2, cuando los mozos carguen desde el celular, el main va a
// AVISAR los cambios al instante y esto va a ser casi innecesario.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Respuesta } from '@compartido/tipos';
import { caja, desenvolver } from '@/lib/api';
import { CLAVE_MENU } from '@/features/menu/consultas';
import { CLAVE_RESUMEN } from '@/features/vender/consultas';

export const CLAVE_SALON = ['salon'] as const;

export function useSalon() {
  return useQuery({
    queryKey: CLAVE_SALON,
    queryFn: () => desenvolver(caja().salon.obtener()),
    refetchInterval: 10_000,
    staleTime: 2_000,
  });
}

/** La cuenta completa de una mesa (rondas, renglones, total). */
export function useCuenta(pedidoId: number | null) {
  return useQuery({
    queryKey: [...CLAVE_SALON, 'cuenta', pedidoId],
    queryFn: () => desenvolver(caja().salon.cuenta(pedidoId!)),
    enabled: pedidoId !== null,
    refetchInterval: 10_000,
    staleTime: 2_000,
  });
}

/** Cualquier cambio en el salón también cambia pedidos, caja y reportes. */
export function useRefrescarSalon() {
  const cliente = useQueryClient();
  return () =>
    Promise.all([
      cliente.invalidateQueries({ queryKey: CLAVE_SALON }),
      cliente.invalidateQueries({ queryKey: ['pedidos'] }),
      cliente.invalidateQueries({ queryKey: CLAVE_RESUMEN }),
      cliente.invalidateQueries({ queryKey: ['caja'] }),
      cliente.invalidateQueries({ queryKey: ['reportes'] }),
      cliente.invalidateQueries({ queryKey: ['usuarios'] }),
    ]);
}

interface Opciones<R> {
  exito?: string | ((resultado: R) => string);
  /** false = el error lo muestra el formulario, no un aviso. */
  avisarError?: boolean;
}

/** Envuelve una acción del salón: la manda al main y refresca todo lo que depende. */
export function useAccionSalon<A extends unknown[], R>(accion: (...args: A) => Promise<Respuesta<R>>, { exito, avisarError = true }: Opciones<R> = {}) {
  const refrescar = useRefrescarSalon();
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => desenvolver(accion(...args)),
    onSuccess: async (resultado) => {
      await refrescar();
      if (exito) toast.success(typeof exito === 'function' ? exito(resultado) : exito);
    },
    onError: (error) => {
      // Si falló porque cambió el menú, lo volvemos a pedir para mostrar lo nuevo.
      void cliente.invalidateQueries({ queryKey: CLAVE_MENU });
      if (avisarError) toast.error(error.message);
    },
  });
}

/** La hora actual, que se actualiza sola (para los "hace 25 min"). */
export function useAhora(cadaMs = 30_000): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), cadaMs);
    return () => window.clearInterval(id);
  }, [cadaMs]);
  return ahora;
}
