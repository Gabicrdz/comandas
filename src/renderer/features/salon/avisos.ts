// Avisos en vivo en la PC: el main manda un "cambio" cada vez que algo pasa
// (por ejemplo, un mozo cargó una ronda desde el celular). Acá se vuelven a
// pedir los datos y, si viene de un celular, se muestra un aviso con sonido.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { caja } from '@/lib/api';
import { CLAVE_MENU } from '@/features/menu/consultas';
import { CLAVE_RESUMEN } from '@/features/vender/consultas';
import { CLAVE_SALON } from './consultas';
import { imprimirRonda } from './panel-mesa';

/** Un "ding" corto, generado con la placa de sonido (no hace falta un archivo de audio). */
function sonar(): void {
  try {
    const audio = new AudioContext();
    const tono = audio.createOscillator();
    const volumen = audio.createGain();
    tono.frequency.value = 880;
    volumen.gain.setValueAtTime(0.15, audio.currentTime);
    volumen.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    tono.connect(volumen).connect(audio.destination);
    tono.start();
    tono.stop(audio.currentTime + 0.35);
    tono.onended = () => void audio.close();
  } catch {
    // sin sonido no pasa nada
  }
}

export function useAvisosEnVivo(activo: boolean): void {
  const cliente = useQueryClient();
  useEffect(() => {
    if (!activo) return;
    return caja().alCambiar((cambio) => {
      if (cambio.tipo === 'menu') {
        void cliente.invalidateQueries({ queryKey: CLAVE_MENU });
        return;
      }
      void cliente.invalidateQueries({ queryKey: CLAVE_SALON });
      void cliente.invalidateQueries({ queryKey: ['pedidos'] });
      void cliente.invalidateQueries({ queryKey: CLAVE_RESUMEN });
      void cliente.invalidateQueries({ queryKey: ['red'] });
      if (cambio.tipo === 'ronda' && cambio.origen === 'celular') {
        sonar();
        toast(`Mesa ${cambio.mesa}: ${cambio.quien} cargó la ronda ${cambio.ronda}`, {
          action: cambio.vaACocina ? { label: 'Imprimir comanda', onClick: () => void imprimirRonda(cambio.pedidoId, cambio.ronda) } : undefined,
          duration: 10_000,
        });
      }
      if (cambio.tipo === 'cuenta' && cambio.origen === 'celular') {
        sonar();
        toast(`La mesa ${cambio.mesa} pide la cuenta`, { description: `Avisó ${cambio.quien}`, duration: 10_000 });
      }
    });
  }, [activo, cliente]);
}
