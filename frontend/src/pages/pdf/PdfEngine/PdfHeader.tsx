/**
 * PdfHeader.tsx — Header UNIQUE, identique sur toutes les pages du PDF
 *
 * Contraintes respectées :
 *  - hauteur fixe : HEADER_H_PX (53px)
 *  - même structure, mêmes espacements sur toutes les pages
 *  - seuls le `title` et le `pageNumber` changent
 *  - meta (client / ref / date) toujours au même endroit
 *
 * Structure visuelle (A4 paysage) :
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  [LOGO]   TITRE DE LA PAGE                   CLIENT  REF  DATE  │
 * │           ─────────────────── trait doré ──────────────────────│
 * │                                                N° PAGE / TOTAL  │
 * └─────────────────────────────────────────────────────────────────┘
 */

import {
  HEADER_H_PX,
  CONTENT_W_PX,
  COLORS,
  FONT,
  PdfMeta,
  fmt,
} from "./pdfLayout";

interface PdfHeaderProps {
  title: string;
  meta?: PdfMeta;
  pageNumber?: number;
  totalPages?: number;
  /** Afficher le logo SolarGlobe (défaut: true) */
  showLogo?: boolean;
}

// Icône soleil SVG inline (pas de dépendance externe)
function SolarGlobeLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-label="SolarGlobe"
      style={{ flexShrink: 0 }}
    >
      {/* Globe */}
      <circle cx="16" cy="16" r="10" fill="none" stroke={COLORS.accentGold} strokeWidth="1.5" />
      <ellipse cx="16" cy="16" rx="5" ry="10" fill="none" stroke={COLORS.accentGold} strokeWidth="1" />
      <line x1="6" y1="16" x2="26" y2="16" stroke={COLORS.accentGold} strokeWidth="1" />
      {/* Rayons soleil */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line
          key={deg}
          x1="16" y1="2"
          x2="16" y2="5"
          stroke={COLORS.accentGold}
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${deg} 16 16)`}
        />
      ))}
    </svg>
  );
}

export default function PdfHeader({
  title,
  meta,
  pageNumber,
  totalPages,
  showLogo = true,
}: PdfHeaderProps) {
  const pageLabel =
    pageNumber != null
      ? totalPages != null
        ? `${pageNumber} / ${totalPages}`
        : String(pageNumber)
      : null;

  return (
    <header
      style={{
        width: CONTENT_W_PX,
        height: HEADER_H_PX,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    >
      {/* Ligne principale */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flex: 1,
        }}
      >
        {/* Logo */}
        {showLogo && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
            <SolarGlobeLogo size={26} />
          </div>
        )}

        {/* Titre */}
        <div
          style={{
            flex: 1,
            fontFamily: FONT.family,
            fontSize: "13.5pt",
            fontWeight: FONT.weightBold,
            color: COLORS.accentGold,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>

        {/* Meta : client / réf / date */}
        {meta && (
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "center",
              flexShrink: 0,
              fontFamily: FONT.family,
              fontSize: FONT.sizeSmall,
              color: COLORS.textSecond,
              lineHeight: 1.3,
            }}
          >
            {meta.client && <span>{fmt(meta.client)}</span>}
            {meta.ref    && <span style={{ opacity: 0.7 }}>{fmt(meta.ref)}</span>}
            {meta.date   && <span>{fmt(meta.date)}</span>}
          </div>
        )}

        {/* Numéro de page */}
        {pageLabel && (
          <div
            style={{
              flexShrink: 0,
              fontFamily: FONT.family,
              fontSize: FONT.sizeSmall,
              fontWeight: FONT.weightMedium,
              color: COLORS.textSecond,
              marginLeft: 8,
              opacity: 0.6,
            }}
          >
            {pageLabel}
          </div>
        )}
      </div>

      {/* Trait doré de séparation */}
      <div
        style={{
          width: "100%",
          height: 1.5,
          background: `linear-gradient(90deg, ${COLORS.accentGold} 0%, ${COLORS.accentGold}40 70%, transparent 100%)`,
          borderRadius: 1,
          marginTop: 4,
        }}
      />
    </header>
  );
}
