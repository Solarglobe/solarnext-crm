import { createRoot } from 'react-dom/client';
import { ConfirmModal } from './ConfirmModal';

let confirmationOpen = false;

/** Keep the export decision in the accessible CRM dialog; concurrent clicks cannot export twice. */
export function confirmStudyDocument(message: string, options: { title?: string; confirmLabel?: string } = {}): Promise<boolean> {
  if (typeof document === 'undefined' || confirmationOpen) return Promise.resolve(false);
  confirmationOpen = true;
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      root.unmount();
      host.remove();
      confirmationOpen = false;
      resolve(confirmed);
    };
    root.render(<ConfirmModal open title={options.title ?? "Export du document"} message={message}
      confirmLabel={options.confirmLabel ?? "Continuer"} cancelLabel="Annuler" variant="warning"
      onConfirm={() => finish(true)} onCancel={() => finish(false)} />);
  });
}
