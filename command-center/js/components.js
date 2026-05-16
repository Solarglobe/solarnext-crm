/**
 * components.js — Render helpers (pure functions: data → HTML string)
 * All functions return HTML strings injected via innerHTML.
 * No direct DOM manipulation here.
 */

/* ================================================================
   LOOKUP TABLES
   ================================================================ */

const PRIORITY_LABELS = {
  critique:  "🔴 Critique",
  important: "🟠 Important",
  polish:    "🟡 Polish",
};

const STATUS_LABELS = {
  todo:        "TODO",
  inprogress:  "EN COURS",
  validated:   "VALIDÉ ✓",
  blocked:     "BLOQUÉ",
};

const STATUS_CLASSES = {
  todo:        "badge-todo",
  inprogress:  "badge-inprogress",
  validated:   "badge-validated",
  blocked:     "badge-blocked",
};

const AREA_LABELS = {
  frontend: "Frontend",
  backend:  "Backend",
  "3d":     "3D",
  css:      "CSS",
  tests:    "Tests",
};

const IMPACT_LABELS = {
  1: "Faible",
  2: "Léger",
  3: "Modéré",
  4: "Élevé",
  5: "Critique",
};

/* Risk level derived from priority + riskDetails presence */
const RISK_LEVELS = {
  critique:  { cls: "risk-high",   label: "⚠ Risque élevé"   },
  important: { cls: "risk-medium", label: "◈ Risque modéré"  },
  polish:    { cls: "risk-low",    label: "◇ Risque faible"  },
};

/* Effort → minutes (for totals) */
const EFFORT_MINUTES = {
  "30min": 30,
  "1h":    60,
  "2h":    120,
  "3h":    180,
  "4h":    240,
  "1j":    480,
  "2j":    960,
  "3j+":   1440,
};

/* Effort → CSS color class */
function _effortClass(effort) {
  const m = EFFORT_MINUTES[effort] || 0;
  if (m <= 60)  return "effort-quick";
  if (m <= 240) return "effort-medium";
  if (m <= 480) return "effort-heavy";
  return "effort-epic";
}

/* Parse effort string → minutes (fallback 0) */
function _effortToMinutes(effort) {
  return EFFORT_MINUTES[effort] || 0;
}

/* Format total minutes → "2j 4h", "6h", "45min" */
function _formatEffortTotal(minutes) {
  if (minutes === 0) return "—";
  const days = Math.floor(minutes / 480);
  const rem  = minutes % 480;
  const hrs  = Math.floor(rem / 60);
  const mins = rem % 60;
  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hrs)  parts.push(`${hrs}h`);
  if (mins && !days) parts.push(`${mins}min`);
  return parts.join(" ") || "—";
}

/* Estimate ~token count for a prompt string (~4 chars/token) */
function _estimateTokens(str) {
  return Math.round((str || "").length / 4);
}

const STATUS_DOT_COLORS = {
  todo:        "var(--text-muted)",
  inprogress:  "var(--warning)",
  validated:   "var(--success)",
  blocked:     "var(--blocked)",
};

/* ================================================================
   BADGE RENDERERS
   ================================================================ */

function renderBadge(cls, text) {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function renderPriorityBadge(priority) {
  return renderBadge(`badge-${priority}`, PRIORITY_LABELS[priority] || priority);
}

function renderStatusBadge(status) {
  return renderBadge(STATUS_CLASSES[status] || "badge-todo", STATUS_LABELS[status] || status);
}

function renderAreaBadge(area) {
  const key = area.toLowerCase().replace(/\s/g, "");
  return renderBadge(`badge-${key}`, AREA_LABELS[key] || area);
}

function renderRiskBadge(item) {
  if (!item.riskDetails) return "";
  const r = RISK_LEVELS[item.priority] || RISK_LEVELS.polish;
  return `<span class="risk-badge ${r.cls}" title="${escAttr(item.riskDetails)}">${escapeHtml(r.label)}</span>`;
}

function renderEffortTag(effort) {
  if (!effort || effort === "—") return "";
  return `<span class="effort-tag ${_effortClass(effort)}">${escapeHtml(effort)}</span>`;
}

function renderDepsPill(item) {
  const deps = item.dependencies || [];
  if (deps.length === 0) return "";
  const blockedCount = deps.filter(d => {
    const dep = ITEMS.find(i => i.id === d);
    return dep && AppState.getItemStatus(d) !== "validated";
  }).length;
  const cls = blockedCount > 0 ? "deps-pill deps-pill--blocked" : "deps-pill";
  const icon = blockedCount > 0 ? "🔒" : "🔗";
  const label = blockedCount > 0
    ? `${blockedCount}/${deps.length} dep. non validée${blockedCount > 1 ? "s" : ""}`
    : `${deps.length} dep. validée${deps.length > 1 ? "s" : ""}`;
  return `<span class="${cls}" title="Dépendances : ${escAttr(deps.join(', '))}">${icon} ${escapeHtml(label)}</span>`;
}

function renderDifficultyDots(n) {
  const val = Math.max(1, Math.min(5, n || 1));
  const dots = "●".repeat(val) + "○".repeat(5 - val);
  const labels = ["", "Facile", "Modéré", "Difficile", "Complexe", "Expert"];
  return `<span class="diff-dots diff-${val}" title="Difficulté : ${labels[val]}">${dots}</span>`;
}

/* ================================================================
   TASK CARD
   ================================================================ */

function renderTaskCard(item) {
  const status     = AppState.getItemStatus(item.id);
  const isChecked  = status === "validated";
  const isBlocked  = status === "blocked";
  const areaBadges = (item.areas || []).slice(0, 3).map(renderAreaBadge).join("");
  const hasBlockedDeps = (item.dependencies || []).some(d =>
    AppState.getItemStatus(d) !== "validated"
  );

  /* Impact bar: 5 filled segments */
  const impactVal  = Math.max(1, Math.min(5, item.impact || 1));
  const impactBar  = Array.from({length: 5}, (_, i) =>
    `<span class="impact-seg ${i < impactVal ? 'filled' : ''}"></span>`
  ).join("");

  return `
<div class="task-card ${isChecked ? 'card-validated' : ''} ${isBlocked ? 'card-blocked-state' : ''}"
     data-id="${escAttr(item.id)}"
     data-priority="${escAttr(item.priority)}"
     data-phase="${escAttr(item.phaseId)}"
     data-status="${escAttr(status)}"
     data-areas="${escAttr((item.areas || []).join(','))}"
     role="listitem"
     tabindex="0"
     aria-label="Tâche ${escAttr(item.id)} : ${escAttr(item.title)}">

  <!-- Header: checkbox + ID + title -->
  <div class="card-header">
    <div class="card-check ${isChecked ? 'checked' : ''}"
         data-id="${escAttr(item.id)}"
         role="checkbox"
         aria-checked="${isChecked}"
         tabindex="-1"
         title="${isChecked ? 'Marquer TODO' : 'Marquer VALIDÉ'}">
    </div>
    <div class="card-title-area">
      <span class="card-id mono">${escapeHtml(item.id)}</span>
      <span class="card-title">${escapeHtml(item.title)}</span>
    </div>
  </div>

  <!-- Badges: priority + status + areas -->
  <div class="card-meta">
    ${renderPriorityBadge(item.priority)}
    ${renderStatusBadge(status)}
    ${areaBadges}
  </div>

  <!-- Description (2 lines max via CSS) -->
  <div class="card-body">${escapeHtml(item.description || '')}</div>

  <!-- Risk + deps pills row -->
  <div class="card-pills">
    ${renderRiskBadge(item)}
    ${renderDepsPill(item)}
    ${hasBlockedDeps ? '<span class="dep-blocked-hint">⛔ Dépendance en attente</span>' : ''}
  </div>

  <!-- Footer: metrics + actions -->
  <div class="card-footer">
    <div class="card-metrics">
      ${renderEffortTag(item.effort)}
      <span class="impact-bar" title="Impact : ${IMPACT_LABELS[impactVal]} (${impactVal}/5)">
        ${impactBar}
      </span>
      ${renderDifficultyDots(item.difficulty)}
    </div>
    <div class="card-actions" style="position:relative">
      <button class="btn-icon quick-status-trigger"
              data-id="${escAttr(item.id)}"
              title="Changer le statut rapidement"
              aria-label="Changer statut ${escAttr(item.id)}">
        ≡
      </button>
      <button class="btn-icon copy-prompt-btn"
              data-id="${escAttr(item.id)}"
              title="Copier le prompt (${escAttr(item.id)})"
              aria-label="Copier le prompt ${escAttr(item.id)}">
        📋
      </button>
    </div>
  </div>
</div>`;
}

/* ================================================================
   QUICK STATUS MENU
   ================================================================ */

function renderQuickStatusMenu(itemId) {
  const current = AppState.getItemStatus(itemId);
  const statuses = [
    { key: "todo",        label: "TODO",       emoji: "○" },
    { key: "inprogress",  label: "EN COURS",   emoji: "◑" },
    { key: "validated",   label: "VALIDÉ",     emoji: "●" },
    { key: "blocked",     label: "BLOQUÉ",     emoji: "✕" },
  ];

  const items = statuses.map(s => `
    <button class="quick-status-item ${current === s.key ? 'active' : ''}"
            data-status="${s.key}"
            data-id="${escAttr(itemId)}">
      <span class="quick-status-dot"
            style="background:${STATUS_DOT_COLORS[s.key]}"></span>
      ${escapeHtml(s.label)}
      ${current === s.key ? `<span style="margin-left:auto;color:var(--text-muted)">✓</span>` : ''}
    </button>`).join("");

  return `<div class="quick-status-menu" id="quick-menu-${escAttr(itemId)}">${items}</div>`;
}

/* ================================================================
   PHASE OVERVIEW CARD
   ================================================================ */

function renderPhaseCard(phase) {
  const items     = ITEMS.filter(i => i.phaseId === phase.id);
  const counts    = _statusCounts(items);
  const validated = counts.validated || 0;
  const inProg    = counts.inprogress || 0;
  const blocked   = counts.blocked || 0;
  const todo      = counts.todo || 0;
  const total     = items.length;
  const pct       = total ? Math.round((validated / total) * 100) : 0;
  const isComplete= pct === 100 && total > 0;

  const pills = [
    { key: "todo",       val: todo,    label: "À faire"  },
    { key: "inprogress", val: inProg,  label: "En cours" },
    { key: "validated",  val: validated,label: "Validées" },
    { key: "blocked",    val: blocked, label: "Bloquées" },
  ].filter(p => p.val > 0);

  const pillsHtml = pills.map(p => `
    <div class="phase-pill ${p.val > 0 ? 'has-value' : ''}">
      <span class="phase-pill-dot ${p.key}"></span>
      ${p.val} ${escapeHtml(p.label)}
    </div>`).join("");

  // If no items yet: show placeholder
  const contentHtml = total === 0
    ? `<p style="font-size:var(--text-xs);color:var(--text-muted);font-style:italic">
         Données injectées à l'étape 3
       </p>`
    : `
      <div class="phase-card-progress">
        <div class="phase-card-progress-row">
          <span>${validated} / ${total} tâches validées</span>
          <span style="color:var(--text-secondary);font-weight:var(--weight-semi)">${pct}%</span>
        </div>
        <div class="phase-card-progress-bar">
          <div class="phase-card-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="phase-card-statuses">${pillsHtml}</div>
    `;

  /* Total effort for this phase */
  const totalMins   = items.reduce((acc, i) => acc + _effortToMinutes(i.effort), 0);
  const effortLabel = _formatEffortTotal(totalMins);
  const critCount   = items.filter(i => i.priority === "critique").length;

  return `
<div class="phase-card ${isComplete ? 'phase-complete' : ''}"
     data-phase="${escAttr(phase.id)}"
     role="listitem button"
     tabindex="0"
     title="Voir la phase ${escAttr(phase.title)}"
     style="--phase-color: ${phase.color}">

  <div class="phase-card-header">
    <span class="phase-card-icon" aria-hidden="true">${phase.icon}</span>
    <div class="phase-card-info">
      <div class="phase-card-number mono">Phase ${phase.number}</div>
      <div class="phase-card-title">${escapeHtml(phase.title)}</div>
      <div class="phase-card-desc">${escapeHtml(phase.desc)}</div>
    </div>
  </div>

  ${contentHtml}

  ${total > 0 ? `
  <div class="phase-card-footer">
    <span class="phase-charge" title="Charge totale estimée">
      ⏱ ${escapeHtml(effortLabel)}
    </span>
    ${critCount > 0 ? `<span class="phase-crits">🔴 ${critCount} critique${critCount > 1 ? 's' : ''}</span>` : ""}
  </div>` : ""}
</div>`;
}

/* ================================================================
   STATS BAR (overview)
   ================================================================ */

function renderStatsBar() {
  const total     = ITEMS.length;
  const counts    = _statusCounts(ITEMS);
  const validated = counts.validated  || 0;
  const inProg    = counts.inprogress || 0;
  const blocked   = counts.blocked    || 0;
  const todo      = total - validated - inProg - blocked;
  const critiques = ITEMS.filter(i => i.priority === "critique").length;

  if (total === 0) {
    return `<div class="stats-bar-card">
      <span class="stats-bar-value v-total">—</span>
      <span class="stats-bar-label">Données à venir</span>
    </div>`;
  }

  return [
    { val: total,                            cls: "v-total",   label: "Tâches total"  },
    { val: critiques,                        cls: "v-critique",label: "🔴 Critiques"  },
    { val: todo,                             cls: "v-todo",    label: "À faire"       },
    { val: inProg,                           cls: "v-progress",label: "En cours"      },
    { val: validated,                        cls: "v-done",    label: "Validées"      },
    { val: blocked,                          cls: "v-blocked", label: "Bloquées"      },
    { val: Math.round(validated/total*100)+"%", cls: "v-done", label: "Avancement"   },
  ].map(s => `
    <div class="stats-bar-card">
      <span class="stats-bar-value ${s.cls}">${s.val}</span>
      <span class="stats-bar-label">${escapeHtml(s.label)}</span>
    </div>`).join("");
}

/* ================================================================
   DISTRIBUTION BAR
   ================================================================ */

function renderDistributionBar() {
  const total     = ITEMS.length;
  if (total === 0) return "";

  const counts    = _statusCounts(ITEMS);
  const validated = counts.validated  || 0;
  const inProg    = counts.inprogress || 0;
  const blocked   = counts.blocked    || 0;
  const todo      = total - validated - inProg - blocked;

  const pct = (n) => Math.round((n / total) * 100);

  const segments = [
    { cls: "seg-validated",  val: validated, pct: pct(validated), label: `${validated} Validées`,  color: "var(--success)" },
    { cls: "seg-inprogress", val: inProg,    pct: pct(inProg),    label: `${inProg} En cours`,     color: "var(--warning)" },
    { cls: "seg-blocked",    val: blocked,   pct: pct(blocked),   label: `${blocked} Bloquées`,    color: "var(--blocked)" },
    { cls: "seg-todo",       val: todo,      pct: pct(todo),      label: `${todo} À faire`,        color: "var(--border-strong)" },
  ].filter(s => s.val > 0);

  const barHtml = segments
    .map(s => `<div class="distribution-segment ${s.cls}" style="width:${s.pct}%"
                    title="${s.label} (${s.pct}%)"></div>`)
    .join("");

  const legendHtml = segments
    .map(s => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${s.color}"></span>
        ${escapeHtml(s.label)} <span style="color:var(--text-disabled)">(${s.pct}%)</span>
      </div>`).join("");

  return `
    <span class="distribution-bar-label">Répartition des statuts</span>
    <div class="distribution-bar" role="img" aria-label="Répartition: ${pct(validated)}% validé">
      ${barHtml}
    </div>
    <div class="distribution-legend">${legendHtml}</div>
  `;
}

/* ================================================================
   PHASE STATS (header dans vue phase)
   ================================================================ */

function renderPhaseStats(phase) {
  const items    = ITEMS.filter(i => i.phaseId === phase.id);
  const counts   = _statusCounts(items);
  const critCount= items.filter(i => i.priority === "critique").length;
  const pct      = items.length
    ? Math.round(((counts.validated || 0) / items.length) * 100)
    : 0;

  if (items.length === 0) {
    return `<div style="font-size:var(--text-xs);color:var(--text-muted);font-style:italic">
      Données injectées à l'étape 3
    </div>`;
  }

  const totalMins   = items.reduce((acc, i) => acc + _effortToMinutes(i.effort), 0);
  const doneMins    = items
    .filter(i => AppState.getItemStatus(i.id) === "validated")
    .reduce((acc, i) => acc + _effortToMinutes(i.effort), 0);
  const effortTotal = _formatEffortTotal(totalMins);
  const effortDone  = _formatEffortTotal(doneMins);

  return `
    <div class="stat-block">
      <span class="stat-value">${items.length}</span>
      <span class="stat-label">Tâches</span>
    </div>
    <div class="stat-block">
      <span class="stat-value critical">${critCount}</span>
      <span class="stat-label">🔴 Critiques</span>
    </div>
    <div class="stat-block">
      <span class="stat-value success">${counts.validated || 0}</span>
      <span class="stat-label">Validées</span>
    </div>
    <div class="stat-block" title="${escapeHtml(effortDone)} validées / ${escapeHtml(effortTotal)} total">
      <span class="stat-value" style="color:var(--accent)">${escapeHtml(effortTotal)}</span>
      <span class="stat-label">⏱ Charge totale</span>
    </div>
    <div class="phase-progress-row" style="min-width:160px">
      <div class="phase-progress-bar">
        <div class="phase-progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="phase-progress-pct">${pct}%</span>
    </div>`;
}

/* ================================================================
   NAV ITEM (used by navigation.js)
   ================================================================ */

function renderNavItem(phase, isActive) {
  const items    = ITEMS.filter(i => i.phaseId === phase.id);
  const validated= items.filter(i => AppState.getItemStatus(i.id) === "validated").length;
  const pct      = items.length ? Math.round((validated / items.length) * 100) : 0;

  const progressHtml = items.length > 0
    ? `<div class="nav-item-progress">
        <span class="nav-item-pct">${pct}%</span>
        <div class="nav-item-bar">
          <div class="nav-item-fill" style="width:${pct}%"></div>
        </div>
      </div>`
    : "";

  return `
<button class="nav-item ${isActive ? 'active' : ''}"
        data-phase="${escAttr(phase.id)}"
        tabindex="0"
        title="${escAttr(phase.title)} — Phase ${escAttr(phase.number)}">
  <span class="nav-item-icon" aria-hidden="true">${phase.icon}</span>
  <div class="nav-item-content">
    <span class="nav-item-label">${escapeHtml(phase.title)}</span>
    <span class="nav-item-sub">${items.length} tâche${items.length !== 1 ? 's' : ''} · ${phase.number}</span>
  </div>
  ${progressHtml}
</button>`;
}

function renderNavItemAll(isActive) {
  return `
<button class="nav-item nav-item-all ${isActive ? 'active' : ''}"
        data-phase="all"
        tabindex="0"
        title="Voir toutes les phases">
  <span class="nav-item-icon" aria-hidden="true">🗂️</span>
  <div class="nav-item-content">
    <span class="nav-item-label">Vue d'ensemble</span>
    <span class="nav-item-sub">${ITEMS.length} tâche${ITEMS.length !== 1 ? 's' : ''}</span>
  </div>
</button>`;
}

/* ================================================================
   MODAL BODY
   ================================================================ */

function renderModalBody(item) {
  const status    = AppState.getItemStatus(item.id);
  const filesList = (item.files || [])
    .map(f => `<code class="file-tag">${escapeHtml(f)}</code>`)
    .join("");

  /* ── Dépendances enrichies avec statut ── */
  const depsHtml = (item.dependencies || []).length
    ? `<div class="modal-section">
        <h4 class="section-label">🔗 Dépendances</h4>
        <div class="deps-cards">
          ${item.dependencies.map(d => {
            const dep       = ITEMS.find(i => i.id === d);
            const depStatus = AppState.getItemStatus(d);
            const depLabel  = dep ? escapeHtml(dep.title) : escapeHtml(d);
            const statusCls = STATUS_CLASSES[depStatus] || "badge-todo";
            const isBlocked = depStatus !== "validated";
            return `<div class="dep-card ${isBlocked ? 'dep-card--pending' : 'dep-card--done'}">
              <span class="dep-card-id mono">${escapeHtml(d)}</span>
              <span class="dep-card-title">${depLabel}</span>
              <span class="badge ${statusCls}" style="margin-left:auto;flex-shrink:0">
                ${STATUS_LABELS[depStatus] || depStatus}
              </span>
            </div>`;
          }).join("")}
        </div>
      </div>`
    : "";

  /* ── Prompt block avec stats ── */
  const chars  = (item.prompt || "").length;
  const tokens = _estimateTokens(item.prompt);
  const promptHtml = item.prompt
    ? `<div class="modal-section modal-section--prompt">
        <div class="prompt-header">
          <h4 class="section-label">🤖 Prompt Ready-to-Send</h4>
          <div class="prompt-meta-row">
            <span class="prompt-stat">${chars.toLocaleString("fr-FR")} car.</span>
            <span class="prompt-stat-sep">·</span>
            <span class="prompt-stat">~${tokens.toLocaleString("fr-FR")} tokens</span>
            <button class="btn-copy-prompt copy-prompt-btn"
                    data-id="${escAttr(item.id)}"
                    aria-label="Copier le prompt ${escAttr(item.id)}">
              <span class="copy-icon">📋</span>
              <span class="copy-label">Copier le prompt</span>
            </button>
          </div>
        </div>
        <pre class="prompt-block">${escapeHtml(item.prompt)}</pre>
      </div>`
    : "";

  /* ── Effort + impact summary ── */
  const impactVal = Math.max(1, Math.min(5, item.impact || 1));
  const impactBar = Array.from({length: 5}, (_, i) =>
    `<span class="impact-seg ${i < impactVal ? 'filled' : ''}"></span>`
  ).join("");

  return `
    <!-- Status buttons -->
    <div class="modal-section">
      <h4 class="section-label">Statut</h4>
      <div class="status-buttons" data-id="${escAttr(item.id)}">
        ${["todo","inprogress","validated","blocked"].map(s => `
          <button class="status-btn ${status === s ? 'active' : ''}"
                  data-status="${s}"
                  data-id="${escAttr(item.id)}">
            ${STATUS_LABELS[s]}
          </button>`).join("")}
      </div>
    </div>

    <!-- Metrics bar -->
    <div class="modal-metrics-bar">
      <div class="modal-metric">
        <span class="modal-metric-label">Effort</span>
        ${renderEffortTag(item.effort)}
      </div>
      <div class="modal-metric">
        <span class="modal-metric-label">Impact</span>
        <span class="impact-bar modal-impact-bar"
              title="${IMPACT_LABELS[impactVal]} (${impactVal}/5)">
          ${impactBar}
          <span class="impact-label">${IMPACT_LABELS[impactVal] || '—'}</span>
        </span>
      </div>
      <div class="modal-metric">
        <span class="modal-metric-label">Difficulté</span>
        ${renderDifficultyDots(item.difficulty)}
      </div>
    </div>

    <!-- Description -->
    <div class="modal-section">
      <h4 class="section-label">Description</h4>
      <p class="modal-text">${escapeHtml(item.description || '—')}</p>
    </div>

    <!-- Risk details -->
    ${item.riskDetails ? `
    <div class="modal-section modal-section--warning">
      <h4 class="section-label">⚠️ Risques de régression</h4>
      <p class="modal-text">${escapeHtml(item.riskDetails)}</p>
    </div>` : ""}

    <!-- Files -->
    ${filesList ? `
    <div class="modal-section">
      <h4 class="section-label">📁 Fichiers concernés</h4>
      <div class="files-list">${filesList}</div>
    </div>` : ""}

    <!-- Deps -->
    ${depsHtml}

    <!-- Prompt -->
    ${promptHtml}
  `;
}

/* ================================================================
   UTILITIES
   ================================================================ */

function _statusCounts(items) {
  const counts = { todo: 0, inprogress: 0, validated: 0, blocked: 0 };
  items.forEach(item => {
    const s = AppState.getItemStatus(item.id);
    counts[s] = (counts[s] || 0) + 1;
  });
  return counts;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
}

function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ================================================================
   COPY + TOAST (globals)
   ================================================================ */

async function copyPrompt(itemId, triggerBtn) {
  const item = ITEMS.find(i => i.id === itemId);
  if (!item || !item.prompt) {
    showToast("❌ Prompt non disponible");
    return;
  }

  /* Find trigger button if not passed */
  const btn = triggerBtn
    || document.querySelector(`.copy-prompt-btn[data-id="${CSS.escape(itemId)}"]`);

  /* Animate button */
  if (btn) {
    btn.classList.add("copy-success");
    const icon  = btn.querySelector(".copy-icon");
    const label = btn.querySelector(".copy-label");
    if (icon)  icon.textContent  = "✅";
    if (label) label.textContent = "Copié !";
    setTimeout(() => {
      btn.classList.remove("copy-success");
      if (icon)  icon.textContent  = "📋";
      if (label) label.textContent = "Copier le prompt";
    }, 2000);
  }

  const chars  = item.prompt.length;
  const tokens = _estimateTokens(item.prompt);

  try {
    await navigator.clipboard.writeText(item.prompt);
    showToast(`✅ Prompt ${itemId} copié — ${tokens.toLocaleString("fr-FR")} tokens`);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = item.prompt;
    ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast(`✅ Prompt ${itemId} copié !`);
  }
}

function showToast(msg, duration = 2800) {
  let t = document.getElementById("cc-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "cc-toast";
    t.style.opacity = "0";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = "0"; }, duration);
}
