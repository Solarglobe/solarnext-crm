import React from "react";

type ButtonVariant = "primary" | "secondary" | "premium" | "ghost" | "danger" | "outlineGold";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: React.ReactNode;
}

/** Géométrie pilotée par `primitives.css` ; ici seulement paddings / typo complémentaires. */
const sizeClass: Record<ButtonSize, string> = {
  sm: "sn-btn-sm",
  md: "",
  lg: "sn-btn-lg",
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { paddingInline: "10px" },
  md: {},
  lg: { paddingInline: "var(--spacing-16, 16px)" },
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "sn-btn sn-btn-primary",
  secondary: "sn-btn sn-btn-secondary",
  premium: "sn-btn sn-btn-primary",
  ghost: "sn-btn sn-btn-ghost",
  danger: "sn-btn sn-btn-danger",
  outlineGold: "sn-btn sn-btn-outline-gold",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  children,
  style,
  className = "",
  type = "button",
  disabled,
  ...props
}: ButtonProps) {
  const sizeCls = sizeClass[size];
  return (
    <button
      type={type}
      data-variant={variant}
      className={`${variantClasses[variant]}${sizeCls ? ` ${sizeCls}` : ""} ${className}`.trim()}
      style={{
        ...sizeStyles[size],
        width: fullWidth ? "100%" : undefined,
        ...style,
      }}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
