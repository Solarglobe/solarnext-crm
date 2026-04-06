/**
 * Statuts métier du lead (colonne `leads.status`, varchar).
 * Inclut les valeurs historiques LEAD / CLIENT et les codes commerciaux étendus.
 */
export type LeadStatus =
  | "LEAD"
  | "CLIENT"
  | "NEW"
  | "QUALIFIED"
  | "APPOINTMENT"
  | "OFFER_SENT"
  | "IN_REFLECTION"
  | "FOLLOW_UP"
  | "LOST"
  | "ARCHIVED"
  | "SIGNED";
