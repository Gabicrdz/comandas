import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { caja, desenvolver } from '@/lib/api';
import type { Rango } from './rangos';

export function useReporte(rango: Rango) {
  return useQuery({
    queryKey: ['reportes', rango.desde, rango.hasta],
    queryFn: () => desenvolver(caja().reportes.obtener(rango)),
    // Mientras carga otro período, se sigue viendo el anterior (sin "saltos").
    placeholderData: keepPreviousData,
  });
}

/** Rendimiento de cada mozo y tiempos de cocina y barra (solo se pide al abrir la pestaña Salón). */
export function useReporteSalon(rango: Rango) {
  return useQuery({
    queryKey: ['reportes', 'salon', rango.desde, rango.hasta],
    queryFn: () => desenvolver(caja().reportes.salon(rango)),
    placeholderData: keepPreviousData,
  });
}
