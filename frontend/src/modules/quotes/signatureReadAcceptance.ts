/** Libellé unique pads mandat + devis (aligné backend/constants/signatureReadAcceptance.js). */
export const SIGNATURE_READ_ACCEPTANCE_LABEL_FR =
  "Je reconnais avoir lu et accepté ce document" as const;

export type SignaturePadConfirmPayload = {
  dataUrl: string;
  accepted: true;
  acceptedLabel: string;
};
