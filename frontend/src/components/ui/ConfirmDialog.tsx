import { ConfirmModal, type ConfirmModalVariant } from "./ConfirmModal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmModalVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ConfirmModal
      open={open}
      title={title}
      message={description}
      confirmLabel={loading ? "Traitement..." : confirmLabel}
      cancelLabel={cancelLabel}
      variant={variant}
      confirmDisabled={loading}
      cancelDisabled={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
