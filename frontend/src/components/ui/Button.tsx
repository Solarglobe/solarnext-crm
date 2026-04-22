import React from "react";

type ButtonVariant = "primary" | "secondary" | "premium" | "ghost" | "danger" | "outlineGold";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { height: 36, padding: "0 var(--spacing-12)", fontSize: 13 },
  md: { height: 44, padding: "0 18px", fontSize: "var(--font-size-body)" },
  lg: { height: 48, padding: "0 var(--spacing-24)", fontSize: "var(--font-size-body-lg)" },
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "sn-btn sn-btn-primary",
  secondary: "sn-btn sn-btn-secondary",
  premium: "sn-btn sn-btn-premium",
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
  return (
    <button
      type={type}
      data-variant={variant}
      className={`${variantClasses[variant]} ${className}`.trim()}
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
