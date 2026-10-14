import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Native modal behavior shared by IDE dialogs: focus containment, Escape and restoration. */
export function ModalSurface({ children, title, onClose, className = '' }: {
  children: ReactNode; title: string; onClose: () => void; className?: string;
}) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { if (timer.current) clearTimeout(timer.current); dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const dismiss = () => {
    if (timer.current || closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { close.current(); return; }
    setClosing(true);
    timer.current = setTimeout(() => { timer.current = null; close.current(); }, 130);
  };
  return <dialog ref={ref} aria-label={title} className={'ide-modal ' + className + (closing ? ' is-closing' : '')}
    onClickCapture={event => { const button = (event.target as Element).closest('button'); if (button && (button.getAttribute('aria-label') === 'Close dialog' || button.textContent?.trim() === 'Close')) { event.preventDefault(); event.stopPropagation(); dismiss(); } }}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
    } }}>
    {children}
  </dialog>;
}
