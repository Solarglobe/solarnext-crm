import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { buildApiUrl } from "@/config/crmApiBase";
import { applyTheme, readStoredTheme } from "../theme/themeApply";
import "./login-premium.css";

function passwordPolicyError(password: string): string {
  if (password.length < 8) return "Le mot de passe doit contenir au moins 8 caracteres.";
  if (!/[A-Z]/.test(password)) return "Ajoutez au moins une majuscule.";
  if (!/[0-9]/.test(password)) return "Ajoutez au moins un chiffre.";
  return "";
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = useMemo(() => params.get("token")?.trim() || "", [params]);
  const [validating, setValidating] = useState(true);
  const [tokenError, setTokenError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    async function validate() {
      if (!token) {
        setTokenError("Lien de reinitialisation manquant.");
        setValidating(false);
        return;
      }
      try {
        const res = await fetch(buildApiUrl(`/auth/reset-password/${encodeURIComponent(token)}`), {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && !res.ok) {
          setTokenError(data.error || "Lien de reinitialisation invalide.");
        }
      } catch {
        if (!cancelled) setTokenError("Validation du lien impossible.");
      } finally {
        if (!cancelled) setValidating(false);
      }
    }
    validate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const policy = passwordPolicyError(password);
    if (policy) {
      setError(policy);
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl("/auth/reset-password"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Reinitialisation impossible");
      setDone(true);
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
        <section className="login-card" aria-label="Reinitialisation mot de passe">
          <header className="login-header">
            <h1>Nouveau mot de passe</h1>
            <p className="login-tagline">
              {done ? "Votre mot de passe a ete modifie." : "Choisissez un mot de passe robuste pour votre compte."}
            </p>
          </header>

          {validating ? (
            <p className="login-tagline">Validation du lien...</p>
          ) : tokenError ? (
            <div className="login-form">
              <div className="login-error">{tokenError}</div>
              <Link to="/forgot-password" className="login-submit login-link-button">Demander un nouveau lien</Link>
            </div>
          ) : done ? (
            <div className="login-form">
              <Link to="/login" className="login-submit login-link-button">Se connecter</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="login-form" noValidate>
              <div className="login-field">
                <label htmlFor="password">Nouveau mot de passe</label>
                <div className="login-input-wrap">
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="confirm">Confirmer le mot de passe</label>
                <div className="login-input-wrap">
                  <input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="login-submit" disabled={loading}>
                {loading ? "Mise a jour..." : "Modifier le mot de passe"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
