// La PANTALLA DE COCINA (o de barra): una página web que la PC sirve por la red
// del local (/cocina), igual que la app del mozo. Se abre en una tablet, en otra
// PC o en una ventana de la misma PC (Ajustes → Pantalla de cocina).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './app';
import '@/index.css';

const consultas = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 2_000 }, mutations: { retry: false } },
});

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <App />
      <Toaster position="top-center" toastOptions={{ classNames: { toast: '!rounded-lg !border-0 !bg-white !text-tinta !font-sans !text-[16px] !shadow-xl', error: '!bg-rojo !text-white' } }} />
    </QueryClientProvider>
  </StrictMode>,
);
