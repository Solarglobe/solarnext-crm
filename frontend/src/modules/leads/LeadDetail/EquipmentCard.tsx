/**
 * Carte équipement — 1 groupe = 1 type (plusieurs lignes = plusieurs unités).
 * Persistance : toujours un tableau plat d’EquipmentItem (schema V2 inchangé côté API).
 */
import React from "react";
import type { EquipmentItem, PacType } from "./equipmentTypes";
import {
  getEquipmentCardHeading,
  getEquipmentCardSubtitle,
  getEquipmentImpactLine,
} from "./equipmentCardUx";

export interface EquipmentCardProps {
  /** Tous les items du même groupe (même kind + même pac_type pour les PAC). */
  items: EquipmentItem[];
  onChangeItem: (id: string, next: EquipmentItem) => void;
  onRemoveItem: (id: string) => void;
  onAddUnit: () => void;
  onRemoveGroup: () => void;
  context?: "actuel" | "avenir";
}

function numOrUndef(v: string): number | undefined {
  if (v === "" || v === null) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function intOrUndef(v: string): number | undefined {
  if (v === "" || v === null) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function equipmentKicker(sample: EquipmentItem): string {
  if (sample.kind === "ve") return "VE";
  if (sample.kind === "ballon") return "ECS";
  return "PAC";
}

function VeLine({
  item,
  onChange,
  onRemoveLine,
}: {
  item: EquipmentItem;
  onChange: (n: EquipmentItem) => void;
  onRemoveLine: () => void;
}) {
  return (
    <div className="crm-lead-equipment-line">
      <div className="crm-lead-equipment-line__grid crm-lead-equipment-line__grid--ve">
        <div className="crm-lead-equipment-line__cell">
          <label>Recharge</label>
          <select
            className="sn-input sn-input--compact"
            value={item.mode_charge === "jour" ? "jour" : "nuit"}
            onChange={(e) =>
              onChange({ ...item, mode_charge: e.target.value as "jour" | "nuit" })
            }
          >
            <option value="nuit">Nuit</option>
            <option value="jour">Jour</option>
          </select>
        </div>
        <div className="crm-lead-equipment-line__cell">
          <label>Rech./sem.</label>
          <input
            className="sn-input sn-input--compact"
            type="number"
            min={1}
            max={14}
            value={item.charges_semaine ?? ""}
            onChange={(e) =>
              onChange({ ...item, charges_semaine: intOrUndef(e.target.value) })
            }
          />
        </div>
        <div className="crm-lead-equipment-line__cell">
          <label>kWh bat.</label>
          <input
            className="sn-input sn-input--compact"
            type="number"
            min={20}
            max={200}
            value={item.batterie_kwh ?? ""}
            onChange={(e) =>
              onChange({ ...item, batterie_kwh: numOrUndef(e.target.value) })
            }
          />
        </div>
      </div>
      <button
        type="button"
        className="crm-lead-equipment-line__remove sn-btn sn-btn-ghost sn-btn-sm"
        onClick={onRemoveLine}
        aria-label="Supprimer cette unité"
      >
        ×
      </button>
    </div>
  );
}

function PacLine({
  item,
  onChange,
  onRemoveLine,
  allowTypeSwitch,
}: {
  item: EquipmentItem;
  onChange: (n: EquipmentItem) => void;
  onRemoveLine: () => void;
  allowTypeSwitch: boolean;
}) {
  const isAirAir = (item.pac_type ?? "air_eau") === "air_air";
  return (
    <div className="crm-lead-equipment-line">
      <div className="crm-lead-equipment-line__grid crm-lead-equipment-line__grid--pac">
        {allowTypeSwitch ? (
          <div className="crm-lead-equipment-line__cell crm-lead-equipment-line__cell--span2">
            <label>Type (chauffage / chauffage + froid)</label>
            <select
              className="sn-input sn-input--compact"
              value={item.pac_type ?? "air_eau"}
              onChange={(e) => {
                const nextType = e.target.value as PacType;
                if (nextType === "air_air") {
                  onChange({
                    ...item,
                    pac_type: "air_air",
                    usage_hiver: item.usage_hiver ?? "moyen",
                    usage_ete: item.usage_ete ?? "moyen",
                    fonctionnement: undefined,
                  });
                } else {
                  onChange({
                    ...item,
                    pac_type: "air_eau",
                    fonctionnement: item.fonctionnement ?? "moyen",
                    usage_hiver: undefined,
                    usage_ete: undefined,
                  });
                }
              }}
            >
              <option value="air_eau">Air / eau — chauffage (circuit eau)</option>
              <option value="air_air">Air / air — chauffage + froid (clim)</option>
            </select>
          </div>
        ) : null}
        <div className="crm-lead-equipment-line__cell">
          <label>Rôle chauffage</label>
          <select
            className="sn-input sn-input--compact"
            value={item.role ?? "principal"}
            onChange={(e) =>
              onChange({ ...item, role: e.target.value as "principal" | "appoint" })
            }
          >
            <option value="principal">Chauffage principal</option>
            <option value="appoint">Appoint</option>
          </select>
        </div>
        <div className="crm-lead-equipment-line__cell">
          <label>Puissance (kW)</label>
          <input
            className="sn-input sn-input--compact"
            type="number"
            min={isAirAir ? 1.5 : 3}
            max={isAirAir ? 12 : 25}
            step={0.1}
            value={item.puissance_kw ?? ""}
            onChange={(e) =>
              onChange({ ...item, puissance_kw: numOrUndef(e.target.value) })
            }
          />
        </div>
        {!isAirAir ? (
          <div className="crm-lead-equipment-line__cell">
            <label>Intensité chauffage (saison froide)</label>
            <select
              className="sn-input sn-input--compact"
              value={item.fonctionnement ?? "moyen"}
              onChange={(e) =>
                onChange({
                  ...item,
                  fonctionnement: e.target.value as "leger" | "moyen" | "intensif",
                })
              }
            >
              <option value="leger">Légère</option>
              <option value="moyen">Modérée</option>
              <option value="intensif">Soutenue</option>
            </select>
          </div>
        ) : (
          <>
            <div className="crm-lead-equipment-line__cell">
              <label>Chauffage — hiver</label>
              <select
                className="sn-input sn-input--compact"
                value={item.usage_hiver ?? "moyen"}
                onChange={(e) =>
                  onChange({
                    ...item,
                    usage_hiver: e.target.value as "faible" | "moyen" | "fort",
                  })
                }
              >
                <option value="faible">Faible</option>
                <option value="moyen">Modérée</option>
                <option value="fort">Forte</option>
              </select>
            </div>
            <div className="crm-lead-equipment-line__cell">
              <label>Froid / clim — été</label>
              <select
                className="sn-input sn-input--compact"
                value={item.usage_ete ?? "moyen"}
                onChange={(e) =>
                  onChange({
                    ...item,
                    usage_ete: e.target.value as "faible" | "moyen" | "fort",
                  })
                }
              >
                <option value="faible">Faible</option>
                <option value="moyen">Modérée</option>
                <option value="fort">Forte</option>
              </select>
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="crm-lead-equipment-line__remove sn-btn sn-btn-ghost sn-btn-sm"
        onClick={onRemoveLine}
        aria-label="Supprimer cette unité"
      >
        ×
      </button>
    </div>
  );
}

function BallonLine({
  item,
  onChange,
  onRemoveLine,
}: {
  item: EquipmentItem;
  onChange: (n: EquipmentItem) => void;
  onRemoveLine: () => void;
}) {
  return (
    <div className="crm-lead-equipment-line">
      <div className="crm-lead-equipment-line__grid crm-lead-equipment-line__grid--ballon">
        <div className="crm-lead-equipment-line__cell">
          <label>Vol. L</label>
          <input
            className="sn-input sn-input--compact"
            type="number"
            min={50}
            max={500}
            value={item.volume_litres ?? ""}
            onChange={(e) =>
              onChange({ ...item, volume_litres: intOrUndef(e.target.value) })
            }
          />
        </div>
        <div className="crm-lead-equipment-line__cell">
          <label>Stratégie</label>
          <select
            className="sn-input sn-input--compact"
            value={item.mode_charge === "pilote" ? "pilote" : "hc"}
            onChange={(e) =>
              onChange({
                ...item,
                mode_charge: e.target.value as "hc" | "pilote",
              })
            }
          >
            <option value="hc">HC</option>
            <option value="pilote">Surplus</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        className="crm-lead-equipment-line__remove sn-btn sn-btn-ghost sn-btn-sm"
        onClick={onRemoveLine}
        aria-label="Supprimer cette unité"
      >
        ×
      </button>
    </div>
  );
}

export default function EquipmentCard({
  items,
  onChangeItem,
  onRemoveItem,
  onAddUnit,
  onRemoveGroup,
  context = "actuel",
}: EquipmentCardProps) {
  if (!items.length) return null;
  const sample = items[0];
  const heading = getEquipmentCardHeading(sample);
  const subtitle = getEquipmentCardSubtitle(sample);
  const impactLine = getEquipmentImpactLine(sample, context);
  const kicker = equipmentKicker(sample);
  const allowPacTypeSwitch = sample.kind === "pac" && items.length === 1;

  return (
    <div className="crm-lead-equipment-card">
      <div className="crm-lead-equipment-card__head">
        <div className="crm-lead-equipment-card__head-main">
          <span className="crm-lead-equipment-card__kicker">{kicker}</span>
          <span className="crm-lead-equipment-card__title">{heading}</span>
          <span className="crm-lead-equipment-card__subtitle">
            {subtitle}
            {items.length > 1 ? ` · ${items.length} unités` : null}
          </span>
        </div>
        <button
          type="button"
          className="crm-lead-equipment-card__remove sn-btn sn-btn-ghost sn-btn-sm"
          onClick={onRemoveGroup}
          aria-label={`Retirer tout le groupe ${heading}`}
        >
          Retirer le groupe
        </button>
      </div>
      {impactLine ? (
        <p className="crm-lead-equipment-card__impact" role="note">
          {impactLine}
        </p>
      ) : null}
      <div className="crm-lead-equipment-card__body crm-lead-equipment-card__body--grouped">
        <div className="crm-lead-equipment-lines">
          {items.map((item) => {
            const key = item.id;
            if (item.kind === "ve") {
              return (
                <VeLine
                  key={key}
                  item={item}
                  onChange={(n) => onChangeItem(item.id, n)}
                  onRemoveLine={() => onRemoveItem(item.id)}
                />
              );
            }
            if (item.kind === "pac") {
              return (
                <PacLine
                  key={key}
                  item={item}
                  allowTypeSwitch={allowPacTypeSwitch}
                  onChange={(n) => onChangeItem(item.id, n)}
                  onRemoveLine={() => onRemoveItem(item.id)}
                />
              );
            }
            if (item.kind === "ballon") {
              return (
                <BallonLine
                  key={key}
                  item={item}
                  onChange={(n) => onChangeItem(item.id, n)}
                  onRemoveLine={() => onRemoveItem(item.id)}
                />
              );
            }
            return null;
          })}
        </div>
        <div className="crm-lead-equipment-card__footer">
          <button
            type="button"
            className="sn-btn sn-btn-outline-gold sn-btn-sm"
            onClick={onAddUnit}
          >
            + Ajouter une unité
          </button>
        </div>
      </div>
    </div>
  );
}
