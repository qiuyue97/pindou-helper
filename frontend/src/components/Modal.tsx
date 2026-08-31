import { useEffect, useRef, type ReactNode } from 'react';

export default function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-layer">
      <div className="modal-backdrop" data-testid="modal-backdrop" onClick={onClose} />
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
