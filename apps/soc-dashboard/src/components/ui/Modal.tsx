import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Shared dialog primitive — Escape-to-close, click-outside-to-close, focus-visible styling. */
export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mirqab-modal-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="glass-panel relative w-full max-w-lg p-6"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute end-4 top-4 rounded-lg p-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 id="mirqab-modal-title" className="pe-8 text-base font-semibold text-white">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}

            <div className="mt-4">{children}</div>

            {footer && (
              <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/10 pt-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
