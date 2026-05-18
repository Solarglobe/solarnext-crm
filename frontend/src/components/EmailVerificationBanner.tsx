import { useEffect, useState } from "react";
import { buildApiUrl } from "@/config/crmApiBase";
import { apiFetch } from "../services/api";
import { getCurrentUser } from "../services/auth.service";

export function EmailVerificationBanner() {
  const [visible, setVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => {
        if (!cancelled) setVisible(user.emailVerified === false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "true") {
      setVisible(false);
      setMessage("Email verifie. Bienvenue sur SolarNext.");
    }
    if (params.get("verified") === "false") {
      setMessage("Lien de verification invalide ou expire.");
    }
  }, []);

  async function resend() {
    setSending(true);
    setMessage("");
    try {
      const res = await apiFetch(buildApiUrl("/auth/resend-verification-email"), {
        method: "POST",
        skipErrorToast: true,
      });
      if (!res.ok) throw new Error("Envoi impossible");
      setMessage("Email de verification envoye.");
    } catch {
      setMessage("Impossible d'envoyer l'email pour le moment.");
    } finally {
      setSending(false);
    }
  }

  if (!visible && !message) return null;

  return (
    <div
      role="status"
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: visible ? "#fff7ed" : "#ecfdf5",
        color: visible ? "#7c2d12" : "#065f46",
        borderBottom: visible ? "1px solid #fed7aa" : "1px solid #a7f3d0",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 14,
      }}
    >
      <span>
        {message || "Confirmez votre email pour debloquer les devis, etudes PV, PDF et la facturation."}
      </span>
      {visible ? (
        <button
          type="button"
          onClick={resend}
          disabled={sending}
          className="sn-btn sn-btn-sm"
          style={{ background: "#2e1a47", color: "#fff", border: "none" }}
        >
          {sending ? "Envoi..." : "Renvoyer l'email"}
        </button>
      ) : null}
    </div>
  );
}
