import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// En la app instalada la ventana solo puede cargar archivos propios
// (Content Security Policy). En desarrollo no se agrega porque Vite necesita
// scripts en línea para recargar la pantalla al guardar.
function politicaDeSeguridad(): Plugin {
  return {
    name: 'politica-de-seguridad',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), politicaDeSeguridad()],
  build: {
    // Tres páginas en el mismo armado: la ventana de la PC (index.html), la app
    // de los mozos (mozo.html) y la pantalla de cocina (cocina.html). Las dos
    // últimas la PC las sirve por la red del local.
    rollupOptions: {
      input: {
        principal: fileURLToPath(new URL('./index.html', import.meta.url)),
        mozo: fileURLToPath(new URL('./mozo.html', import.meta.url)),
        cocina: fileURLToPath(new URL('./cocina.html', import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@compartido': fileURLToPath(new URL('./src/compartido', import.meta.url)),
    },
  },
});
