// La app de los MOZOS: una página web común que la PC de la caja les sirve a
// los celulares por la red del local (ver src/main/red/servidor.ts). No usa
// Electron ni el preload: habla con la PC por HTTP (fetch) y recibe los avisos
// por SSE. Reutiliza los componentes y estilos de la ventana de la PC.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './app';
import '@/index.css';

const consultas = new QueryClient({
  defaultOptions: {
    // En el celular sí conviene refrescar al volver a la app (estuvo en el bolsillo).
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 3_000 },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast: '!rounded-lg !border-0 !bg-tinta !text-white !font-sans !text-[15px] !shadow-xl',
            description: '!text-white/70',
            error: '!bg-rojo',
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
