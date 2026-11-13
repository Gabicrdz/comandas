import { useMemo } from 'react';
import { generarQr } from '@compartido/qr';

/**
 * Dibuja un código QR como SVG: cada módulo negro es un cuadradito. Se dibuja
 * todo en UN solo <path> (más liviano que cientos de <rect>). El borde blanco
 * de 4 módulos es obligatorio: sin él, muchas cámaras no lo leen.
 */
export function CodigoQr({ texto, tamano = 168, etiqueta }: { texto: string; tamano?: number; etiqueta: string }) {
  const { lado, camino } = useMemo(() => {
    const m = generarQr(texto);
    let d = '';
    m.forEach((fila, f) =>
      fila.forEach((negro, c) => {
        if (negro) d += `M${c + 4} ${f + 4}h1v1h-1z`;
      }),
    );
    return { lado: m.length + 8, camino: d };
  }, [texto]);
  return (
    <svg role="img" aria-label={etiqueta} width={tamano} height={tamano} viewBox={`0 0 ${lado} ${lado}`} shapeRendering="crispEdges" className="rounded-lg bg-white">
      <path d={camino} fill="#000" />
    </svg>
  );
}
