/** Logo de Comandas: un ticket con el corte dentado y una tilde (pedido tomado), sobre fondo mostaza. */
export function Marca({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#f2b705" />
      <path
        d="M12 9h16v20l-2.67 2-2.66-2-2.67 2-2.67-2-2.66 2L12 29z"
        fill="#1b1c1e"
      />
      <path d="M15.2 15.6l2.4 2.4 5.2-5.4" fill="none" stroke="#f2b705" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="15.5" y="21" width="9" height="2.2" rx="1.1" fill="#f2b705" />
      <rect x="15.5" y="25" width="5.5" height="2" rx="1" fill="#f2b705" />
    </svg>
  );
}
