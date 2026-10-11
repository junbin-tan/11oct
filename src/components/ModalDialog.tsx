import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

interface ModalDialogProps {
  label: string;
  children: ReactNode;
  onClose: () => void;
  variant?: 'card' | 'fullscreen' | 'map';
}

export function ModalDialog({ label, children, onClose, variant = 'card' }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      openerRef.current?.focus();
    };
  }, []);

  const closeFromBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`modal modal-${variant}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={closeFromBackdrop}
    >
      {children}
    </dialog>
  );
}
