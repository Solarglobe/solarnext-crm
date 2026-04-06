/**
 * Route historique : /admin/smartpitch-settings
 * Les hypothèses économiques globales ne sont plus éditables ici :
 * source unique = Paramètres PV > Économie → organizations.settings_json.economics
 */

import React from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";

export default function AdminSmartpitchSettings() {
  return (
    <div style={{ padding: "var(--spacing-24)", maxWidth: 640, margin: "0 auto" }}>
      <header style={{ marginBottom: "var(--spacing-24)" }}>
        <h1 className="sg-title">Paramètres SmartPitch</h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--font-size-body)",
            marginTop: "var(--spacing-8)",
          }}
        >
          Cette page ne contient plus de formulaire économique.
        </p>
      </header>

      <Card variant="premium" padding="lg">
        <p
          style={{
            margin: "0 0 var(--spacing-16)",
            fontSize: "var(--font-size-body)",
            lineHeight: 1.55,
            color: "var(--text-primary)",
          }}
        >
          Les <strong>paramètres économiques globaux</strong> (prix kWh, croissance, OA, primes,
          horizon, maintenance, onduleur, dégradation PV et batterie, etc.) sont désormais pilotés
          uniquement depuis <strong>Paramètres PV &gt; Économie</strong>. Ils sont enregistrés dans{" "}
          <code style={{ fontSize: "0.9em" }}>organizations.settings_json.economics</code> et utilisés
          par le moteur, la finance et les scénarios.
        </p>
        <p
          style={{
            margin: "0 0 var(--spacing-20)",
            fontSize: "var(--font-size-body-sm)",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Ancien raccourci : cette URL reste valide pour les favoris ; elle ne permet plus de modifier
          l’économie en doublon.
        </p>
        <Link
          to="/admin/settings/pv"
          className="sn-btn sn-btn-primary"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 44,
            padding: "0 18px",
            fontSize: "var(--font-size-body)",
            textDecoration: "none",
            borderRadius: "var(--radius-btn)",
          }}
        >
          Ouvrir Paramètres PV (onglet Économie)
        </Link>
      </Card>
    </div>
  );
}
