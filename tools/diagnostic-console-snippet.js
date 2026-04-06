/**
 * DIAGNOSTIC RUNTIME — Coller ce script dans la console DevTools (F12)
 * quand une carte Kanban est visible sur la page /leads
 *
 * Copier tout le contenu ci-dessous (entre les ===) et coller dans la console.
 */

(function() {
  const card = document.querySelector(".lead-card");
  if (!card) {
    console.log("Aucune carte .lead-card trouvée. Êtes-vous sur /leads avec des leads ?");
    return;
  }

  const computed = window.getComputedStyle(card);
  const bg = computed.backgroundColor || computed.background;

  console.log("\n========== RAPPORT DIAGNOSTIC RUNTIME ==========\n");
  console.log("Classes de la carte:", card.className);
  console.log("BACKGROUND CALCULÉ RÉEL:", bg);
  console.log("background-color:", computed.backgroundColor);
  console.log("background-image:", computed.backgroundImage);

  // Règles qui matchent et définissent background
  const rules = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules || []) {
        if (rule.selectorText && card.matches(rule.selectorText)) {
          const bgVal = rule.style?.background || rule.style?.backgroundColor;
          if (bgVal) {
            rules.push({
              selector: rule.selectorText,
              background: bgVal,
              href: (sheet.href || "").split("/").pop() || "(inline)"
            });
          }
        }
      }
    } catch (_) {}
  }

  console.log("\n--- RÈGLES CSS (background) ---");
  rules.forEach((r, i) => console.log(`${i+1}. ${r.selector} → ${r.background} (${r.href})`));
  console.log("\n================================================\n");
})();
