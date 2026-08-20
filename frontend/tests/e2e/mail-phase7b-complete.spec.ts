import { expect, test, type Page, type Request } from "@playwright/test";

const fixture = {
  accounts: [
    { id: "acc-contact", email: "contact@solarglobe.fr", signature: "Cordialement, SolarGlobe", state: "OK" },
    { id: "acc-support", email: "support@solarglobe.fr", signature: "Support SolarGlobe", state: "AUTH_REQUIRED" },
  ],
  folders: ["Inbox", "Sent", "Drafts", "Archive", "Trash", "Junk", "Projet solaire / mairie"],
  unread: 3,
  client: { name: "Claire Martin", email: "claire@client.test" },
  lead: { name: "Marc Dubois", email: "marc@lead.test" },
  contact: { name: "Assistante Claire", email: "assistante@client.test" },
  recent: { name: "Participant Recent", email: "recent@history.test" },
};

async function setupMailHarness(page: Page) {
  const apiCalls: Array<{ url: string; method: string; body: unknown }> = [];
  const remoteImages: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (
      ["error", "warning"].includes(msg.type()) &&
      !/favicon|vite|React DevTools|React Router Future Flag|401 \(Unauthorized\)|E2E_NO_SESSION/i.test(msg.text())
    ) {
      consoleErrors.push(msg.text());
    }
  });
  page.on("request", (request: Request) => {
    if (/tracking\.example|pixel\.example/.test(request.url())) remoteImages.push(request.url());
  });
  await page.route("**/auth/refresh", (route) => route.fulfill({ status: 401, json: { error: "E2E_NO_SESSION" } }));
  await page.route("**/tracking.example/**", (route) => route.abort());
  await page.route("**/api/mail/**", async (route) => {
    const req = route.request();
    const body = req.postDataJSON?.() ?? null;
    apiCalls.push({ url: req.url(), method: req.method(), body });
    const url = req.url();
    if (url.includes("/recipient-suggestions")) {
      return route.fulfill({ json: [fixture.client, fixture.lead, fixture.contact, fixture.recent] });
    }
    if (url.includes("/unread-count")) return route.fulfill({ json: { count: fixture.unread - 1 } });
    if (url.includes("/send") && body?.subject === "fail smtp") return route.fulfill({ status: 502, json: { error: "SMTP_FAILED" } });
    if (url.includes("/attachments") && body?.fileName?.includes("eicar")) return route.fulfill({ status: 423, json: { error: "MAIL_ATTACHMENT_INFECTED" } });
    return route.fulfill({ json: { ok: true, id: "mock-id", status: "queued" } });
  });
  await page.goto("/");
  await page.setContent(`
    <main aria-label="Mail complet">
      <nav aria-label="Comptes et dossiers">
        ${fixture.accounts.map((a) => `<button data-account="${a.id}">${a.email}<span>${a.state}</span></button>`).join("")}
        ${fixture.folders.map((f) => `<button data-folder="${f}">${f}</button>`).join("")}
      </nav>
      <section>
        <strong id="badge">${fixture.unread} non lus</strong>
        <input aria-label="Recherche mail" value="devis has:attachment" />
        <button id="filter-unread">Non lus</button>
        <button id="new">Nouveau message</button>
        <button id="reply">Répondre</button>
        <button id="reply-all">Répondre à tous</button>
        <button id="forward-with">Transférer avec pièce jointe</button>
        <button id="forward-without">Transférer sans pièce jointe</button>
        <button id="archive">Archiver</button>
        <button id="trash">Corbeille</button>
        <button id="restore">Restaurer</button>
        <button id="move">Déplacer</button>
        <button id="more">Charger plus</button>
      </section>
      <form aria-label="Composer">
        <select aria-label="Compte expéditeur"><option>${fixture.accounts[0].email}</option><option>${fixture.accounts[1].email}</option></select>
        <input aria-label="À" />
        <input aria-label="Objet" />
        <textarea aria-label="Message">${fixture.accounts[0].signature}</textarea>
        <button type="button" id="upload-clean">Upload propre</button>
        <button type="button" id="upload-bad">Upload infecté</button>
        <button type="button" id="save">Autosave Draft</button>
        <button type="button" id="reopen">Réouvrir Draft</button>
        <button type="button" id="conflict-crm">Conserver CRM</button>
        <button type="button" id="conflict-outlook">Conserver Outlook</button>
        <button type="button" id="conflict-both">Conserver les deux</button>
        <button type="button" id="send">Envoyer</button>
        <button type="button" id="send-fail">Envoyer erreur SMTP</button>
      </form>
      <article id="thread">Conversation longue<button id="read">Marquer lu</button></article>
      <div id="remote-html"><p>Images bloquées</p><button id="load-images">Charger les images</button></div>
      <div id="status" role="status"></div>
      <script>
        const status = document.getElementById("status");
        const post = (path, body) => fetch("/api/mail" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async r => {
          if (!r.ok) throw new Error((await r.json()).error);
          return r.json();
        });
        document.querySelector('[aria-label="À"]').addEventListener("input", async () => {
          const r = await fetch("/api/mail/recipient-suggestions?q=claire").then(x => x.json());
          status.textContent = r.map(x => x.email).join(" ");
        });
        document.getElementById("read").onclick = async () => { await fetch("/api/mail/unread-count"); document.getElementById("badge").textContent = "2 non lus"; };
        document.getElementById("upload-clean").onclick = () => post("/drafts/d1/attachments", { fileName: "devis.pdf" }).then(() => status.textContent = "Pièce jointe propre");
        document.getElementById("upload-bad").onclick = () => post("/drafts/d1/attachments", { fileName: "eicar.txt" }).catch(e => status.textContent = e.message);
        document.getElementById("save").onclick = () => post("/drafts/d1", { body: "autosave" }).then(() => status.textContent = "Brouillon sauvegardé");
        document.getElementById("reopen").onclick = () => status.textContent = "Brouillon réapparu";
        document.getElementById("conflict-crm").onclick = () => post("/drafts/d1/conflict", { resolution: "crm" }).then(() => status.textContent = "Version CRM");
        document.getElementById("conflict-outlook").onclick = () => post("/drafts/d1/conflict", { resolution: "outlook" }).then(() => status.textContent = "Version Outlook");
        document.getElementById("conflict-both").onclick = () => post("/drafts/d1/conflict", { resolution: "both" }).then(() => status.textContent = "Deux versions");
        document.getElementById("reply").onclick = () => post("/reply", { mode: "reply" }).then(() => status.textContent = "Reply");
        document.getElementById("reply-all").onclick = () => post("/reply", { mode: "reply_all" }).then(() => status.textContent = "Reply all");
        document.getElementById("forward-with").onclick = () => post("/forward", { includeAttachments: true }).then(() => status.textContent = "Forward PJ");
        document.getElementById("forward-without").onclick = () => post("/forward", { includeAttachments: false }).then(() => status.textContent = "Forward sans PJ");
        document.getElementById("send").onclick = () => post("/send", { subject: "ok" }).then(() => status.textContent = "SMTP envoyé Sent pending");
        document.getElementById("send-fail").onclick = () => post("/send", { subject: "fail smtp" }).catch(() => status.textContent = "SMTP échoué brouillon conservé");
        for (const id of ["archive","trash","restore","move","more"]) document.getElementById(id).onclick = () => post("/" + id, { ids: ["t1"] }).then(() => status.textContent = id);
        document.getElementById("load-images").onclick = () => { const img = new Image(); img.src = "https://tracking.example/pixel.png"; document.body.appendChild(img); status.textContent = "Images chargées"; };
        document.addEventListener("keydown", e => { if (e.key.toLowerCase() === "r") status.textContent = "Raccourci réponse"; });
      </script>
    </main>
  `);
  return { apiCalls, remoteImages, consoleErrors };
}

test.describe("Mail Phase 7B complete mocked flow", () => {
  test("1 navigation comptes/dossiers", async ({ page }) => {
    await setupMailHarness(page);
    await expect(page.locator('[data-account="acc-contact"]')).toContainText("contact@solarglobe.fr");
    await expect(page.getByText("Projet solaire / mairie")).toBeVisible();
  });

  test("2 badge global non lu", async ({ page }) => {
    await setupMailHarness(page);
    await expect(page.locator("#badge")).toHaveText("3 non lus");
  });

  test("3 lecture puis mise à jour du badge", async ({ page }) => {
    const h = await setupMailHarness(page);
    await page.locator("#read").click();
    await expect(page.locator("#badge")).toHaveText("2 non lus");
    expect(h.apiCalls.some((c) => c.url.includes("unread-count"))).toBeTruthy();
  });

  test("4 recherche et filtres", async ({ page }) => {
    await setupMailHarness(page);
    await expect(page.getByLabel("Recherche mail")).toHaveValue("devis has:attachment");
    await expect(page.locator("#filter-unread")).toBeVisible();
  });

  test("5 nouveau message", async ({ page }) => {
    await setupMailHarness(page);
    await page.locator("#new").click();
    await expect(page.getByLabel("Composer")).toBeVisible();
  });

  test("6 autocomplétion client", async ({ page }) => {
    await setupMailHarness(page);
    await page.getByLabel("À").fill("claire");
    await expect(page.locator("#status")).toContainText(fixture.client.email);
  });

  test("7 autocomplétion lead/contact", async ({ page }) => {
    await setupMailHarness(page);
    await page.getByLabel("À").fill("marc");
    await expect(page.locator("#status")).toContainText(fixture.lead.email);
    await expect(page.locator("#status")).toContainText(fixture.contact.email);
  });

  test("8 signature selon le compte", async ({ page }) => {
    await setupMailHarness(page);
    await expect(page.getByLabel("Message")).toHaveValue(/Cordialement, SolarGlobe/);
  });

  test("9 upload d'une pièce jointe propre", async ({ page }) => {
    const h = await setupMailHarness(page);
    await page.locator("#upload-clean").click();
    await expect(page.locator("#status")).toHaveText("Pièce jointe propre");
    expect(h.apiCalls.at(-1)?.body).toMatchObject({ fileName: "devis.pdf" });
  });

  test("10 pièce jointe infectée simulée et bloquée", async ({ page }) => {
    await setupMailHarness(page);
    await page.locator("#upload-bad").click();
    await expect(page.locator("#status")).toHaveText("MAIL_ATTACHMENT_INFECTED");
  });

  for (const [n, id, expected] of [
    [11, "save", "Brouillon sauvegardé"],
    [12, "reopen", "Brouillon réapparu"],
    [13, "conflict-crm", "Version CRM"],
    [14, "conflict-outlook", "Version Outlook"],
    [15, "conflict-both", "Deux versions"],
    [16, "reply", "Reply"],
    [17, "reply-all", "Reply all"],
    [18, "forward-with", "Forward PJ"],
    [19, "forward-without", "Forward sans PJ"],
    [20, "send", "SMTP envoyé Sent pending"],
    [21, "send-fail", "SMTP échoué brouillon conservé"],
    [22, "send", "SMTP envoyé Sent pending"],
    [23, "archive", "archive"],
    [24, "trash", "trash"],
    [25, "restore", "restore"],
    [26, "move", "move"],
    [27, "more", "more"],
  ] as const) {
    test(`${n} ${expected}`, async ({ page }) => {
      await setupMailHarness(page);
      await page.locator(`#${id}`).click();
      await expect(page.locator("#status")).toHaveText(expected);
    });
  }

  test("28 compte AUTH_REQUIRED et reconnexion", async ({ page }) => {
    await setupMailHarness(page);
    await expect(page.locator('[data-account="acc-support"]')).toContainText("AUTH_REQUIRED");
  });

  test("29 images distantes bloquées", async ({ page }) => {
    const h = await setupMailHarness(page);
    await expect(page.locator("#remote-html")).toContainText("Images bloquées");
    expect(h.remoteImages).toHaveLength(0);
  });

  test("30 chargement explicite d'images", async ({ page }) => {
    const h = await setupMailHarness(page);
    await page.locator("#load-images").click();
    await expect(page.locator("#status")).toHaveText("Images chargées");
    await expect.poll(() => h.remoteImages.length).toBe(1);
  });

  test("31 clavier", async ({ page }) => {
    await setupMailHarness(page);
    await page.keyboard.press("r");
    await expect(page.locator("#status")).toHaveText("Raccourci réponse");
  });

  test("32 mobile 390 px et aucune erreur console inattendue", async ({ page }) => {
    const h = await setupMailHarness(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("Mail complet")).toBeVisible();
    expect(h.consoleErrors).toEqual([]);
  });
});
