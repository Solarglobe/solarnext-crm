import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { buildApiUrl } from "@/config/crmApiBase";
import { applyTheme, readStoredTheme } from "../theme/themeApply";
import "./login-premium.css";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("sn-auth-page");
    document.documentElement.classList.remove("sn-app-page");
    applyTheme("light");
    return () => {
      document.documentElement.classList.remove("sn-auth-page");
      applyTheme(readStoredTheme());
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl("/auth/forgot-password"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Impossible d'envoyer la demande");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel-left" aria-hidden="true">
        <div className="login-brand">
          <div className="logo-container">
            <img src="/dark-logo.png" alt="SolarNext" className="login-brand-logo" decoding="async" />
          </div>
          <p className="login-brand-pitch">Votre CRM photovoltaique de bout en bout.</p>
        </div>
      </div>
      <main className="login-panel-right">
        <section className="login-card" aria-label="Mot de passe oublie">
          <header className="login-header">
            <h1>Mot de passe oublie</h1>
            <p className="login-tagline">
              {sent
                ? "Si un compte existe, un lien de reinitialisation vient d'etre envoye."
                : "Recevez un lien valable 1 heure pour choisir un nouveau mot de passe."}
            </p>
          </header>

          {!sent ? (
            <form onSubmit={handleSubmit} className="login-form" noValidate>
              <div className="login-field">
                <label htmlFor="email">Adresse e-mail</label>
                <div className="login-input-wrap">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="vous@entreprise.fr"
                  />
                </div>
              </div>
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="login-submit" disabled={loading || !email.trim()}>
                {loading ? "Envoi..." : "Envoyer le lien"}
              </button>
            </form>
          ) : (
            <div className="login-form">
              <Link to="/login" className="login-submit login-link-button">Retour a la connexion</Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
