import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  login,
  isAuthenticated,
  LoginAmbiguousError,
} from "../services/auth.service";
import "./login-premium.css";

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16v10H4V7z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M4 7l8 5 8-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M8 11V8a4 4 0 018 0v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconEye({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 3l18 18M10.58 10.58a2 2 0 002.83 2.83M9.88 9.88A3 3 0 0117 12c0 .88-.36 1.68-.94 2.26M6.53 6.53C4.48 7.63 3 10 3 12s3 7 9 7c1.95 0 3.55-.45 4.82-1.18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14.12 14.12a3 3 0 01-4.24-4.24M1 12s3-7 11-7c.53 0 1.04.05 1.52.14M19.42 15.58A18.09 18.09 0 0021 12c-1.73-3.45-5.33-7-12-7-.69 0-1.35.06-2 .17"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FEATURES = [
  "Leads & pipeline commercial",
  "Études PV & calpinage 3D",
  "Dossiers réglementaires (DP)",
  "Suivi opérationnel & SAV",
];

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Désambiguïsation login quand le même email existe dans plusieurs organisations. */
  const [orgChoices, setOrgChoices] = useState<
    { id: string; name: string | null }[] | null
  >(null);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("sn-auth-page");
    document.documentElement.classList.remove("sn-app-page");
    const saved = localStorage.getItem("solarnext_theme");
    const restoreDark = saved === "dark";
    document.documentElement.classList.remove("theme-light", "theme-dark");
    document.documentElement.classList.add("theme-light");

    return () => {
      document.documentElement.classList.remove("sn-auth-page");
      document.documentElement.classList.remove("theme-light", "theme-dark");
      document.documentElement.classList.add(
        restoreDark ? "theme-dark" : "theme-light"
      );
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const orgId =
        orgChoices && orgChoices.length > 0 ? selectedOrgId || undefined : undefined;
      await login(email, password, orgId);
      setOrgChoices(null);
      setSelectedOrgId("");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof LoginAmbiguousError) {
        setOrgChoices(err.organizations);
        setSelectedOrgId(err.organizations[0]?.id ?? "");
        setError(err.message);
      } else {
        setOrgChoices(null);
        setSelectedOrgId("");
        setError(
          err instanceof Error ? err.message : "Identifiants invalides"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="login-page">
      {/* ── Panneau gauche — brand ── */}
      <div className="login-panel-left" aria-hidden="true">
        <div className="login-brand">
          <div className="logo-container">
            <img
              src="/dark-logo.png"
              alt="SolarNext"
              className="login-brand-logo"
              decoding="async"
            />
          </div>
          <p className="login-brand-pitch">
            Votre CRM photovoltaïque de bout en bout.
          </p>
          <ul className="login-features" aria-hidden="true">
            {FEATURES.map((f) => (
              <li key={f} className="login-feature-item">
                <span className="login-feature-dot" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </div>
        <footer className="login-footer-left">
          © {year} SolarNext. Tous droits réservés.
        </footer>
      </div>

      {/* ── Panneau droit — formulaire ── */}
      <div className="login-panel-right">
        <div className="login-card">
          <header className="login-card-header">
            <h1>
              <span className="login-title-muted">Connexion à </span>
              <span className="login-title-solar">Solar</span>
              <span className="login-title-next">Next</span>
            </h1>
            <p className="login-tagline">
              Entrez vos identifiants pour accéder à votre espace.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <div className="login-field">
              <label htmlFor="email">Adresse e-mail</label>
              <div className="login-input-wrap">
                <span className="login-input-icon" aria-hidden>
                  <IconMail />
                </span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setOrgChoices(null);
                    setSelectedOrgId("");
                  }}
                  required
                  autoComplete="email"
                  placeholder="vous@entreprise.fr"
                />
              </div>
            </div>

            <div className="login-field">
              <div className="login-field-label-row">
                <label htmlFor="password">Mot de passe</label>
                <a href="/forgot-password" className="login-forgot">
                  Mot de passe oublié ?
                </a>
              </div>
              <div className="login-password-wrap">
                <span className="login-input-icon--left" aria-hidden>
                  <IconLock />
                </span>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setOrgChoices(null);
                    setSelectedOrgId("");
                  }}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword
                      ? "Masquer le mot de passe"
                      : "Afficher le mot de passe"
                  }
                >
                  <IconEye visible={showPassword} />
                </button>
              </div>
            </div>

            {orgChoices && orgChoices.length > 0 && (
              <div className="login-field">
                <label htmlFor="organization">Organisation</label>
                <select
                  id="organization"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                >
                  {orgChoices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name?.trim() ? o.name : o.id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error ? <p className="login-error">{error}</p> : null}

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        </div>

        <footer className="login-footer-right">
          © {year} SolarNext. Tous droits réservés.
        </footer>
      </div>
    </div>
  );
}
