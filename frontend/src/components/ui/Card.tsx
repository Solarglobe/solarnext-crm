import React from "react";

/**
 * Variantes de surface (2 rendus réels : plat vs surélevé).
 * `premium` et `app` sont conservées pour compat API : mappées respectivement sur surélevé et plat.
 */
type CardVariant = "default" | "elevated" | "premium" | "app";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  variant?: CardVariant;
  style?: React.CSSProperties;
}

const paddingMap = {
  none: 0,
  sm: "var(--spacing-12)",
  md: "var(--spacing-16)",
  lg: "var(--spacing-24)",
};

export function Card({
  children,
  className = "",
  padding = "md",
  variant = "default",
  style,
}: CardProps) {
  const classes = [
    "sn-card",
    (variant === "elevated" || variant === "premium") && "sn-card-elevated",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{
        padding: paddingMap[padding],
        ...style,
      }}
    >
      {children}
    </div>
  );
}
