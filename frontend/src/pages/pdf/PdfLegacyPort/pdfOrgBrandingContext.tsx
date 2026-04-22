/**
 * Branding PDF étude (couleur + nom affiché) — fourni par PdfLegacyPort.
 */

import React, { createContext, useContext } from "react";
import { DEFAULT_PDF_PRIMARY_COLOR, resolvePdfPrimaryColor } from "../pdfBrand";

export type PdfOrgBranding = {
  brandHex: string;
  /** Nom affiché documents (juridique → commercial → nom). */
  orgDisplayName: string;
};

const defaultValue: PdfOrgBranding = {
  brandHex: DEFAULT_PDF_PRIMARY_COLOR,
  orgDisplayName: "",
};

export const PdfOrgBrandingContext = createContext<PdfOrgBranding>(defaultValue);

export function usePdfOrgBranding(): PdfOrgBranding {
  return useContext(PdfOrgBrandingContext);
}

export function computeOrgDisplayNameFromVmOrg(org: {
  legal_name?: string | null;
  trade_name?: string | null;
  name?: string | null;
}): string {
  const legal = String(org.legal_name ?? "").trim();
  const trade = String(org.trade_name ?? "").trim();
  const n = String(org.name ?? "").trim();
  return legal || trade || n || "";
}

type ProviderProps = {
  pdfPrimaryColor: string | null | undefined;
  organization: {
    legal_name?: string | null;
    trade_name?: string | null;
    name?: string | null;
  };
  children: React.ReactNode;
};

export function PdfOrgBrandingProvider({ pdfPrimaryColor, organization, children }: ProviderProps) {
  const brandHex = resolvePdfPrimaryColor(pdfPrimaryColor ?? undefined);
  const orgDisplayName = computeOrgDisplayNameFromVmOrg(organization);
  const value = React.useMemo(
    () => ({ brandHex, orgDisplayName }),
    [brandHex, orgDisplayName]
  );
  return <PdfOrgBrandingContext.Provider value={value}>{children}</PdfOrgBrandingContext.Provider>;
}
