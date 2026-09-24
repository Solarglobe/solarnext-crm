/** One immutable study/version, one writer, and separate local/server receipts. */
export type CalpinageGeometry = Record<string, any>;
export type SaveScope = { studyId: string; versionId: string };
export type SaveState = {
  revision: number;
  revisionId: string | null;
  local: "unchecked" | "saved" | "failed";
  localRevision: number | null;
  server: "loading" | "idle" | "pending" | "saving" | "confirmed" | "failed" | "conflict";
  confirmedRevision: number | null;
  ready: boolean;
  error: string | null;
};
type ServerDocument = { geometry: CalpinageGeometry | null; serverRevision: string | null };
type Dependencies = {
  scope: SaveScope;
  writeLocal: (geometry: CalpinageGeometry) => void;
  readLocal: () => CalpinageGeometry | null;
  post: (geometry: CalpinageGeometry, expectedRevision: string | null) => Promise<ServerDocument>;
  readServer: () => Promise<ServerDocument>;
  onConfirmed?: () => void;
  debounceMs?: number;
};

export class CalpinageSaveError extends Error {
  constructor(message: string, readonly conflict = false) { super(message); }
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

// Export timestamps change on every render; they are not edits or save receipts.
function contentKey(geometry: CalpinageGeometry): string {
  const value = copy(geometry);
  delete value.persistence;
  if (value.meta) delete value.meta.generatedAt;
  if (value.calpinageCheckpoint) delete value.calpinageCheckpoint.savedAt;
  if (value.calpinage_meta) delete value.calpinage_meta.savedAt;
  return JSON.stringify(value);
}

export class CalpinageSaveSession {
  readonly scope: SaveScope;
  private state: SaveState = {
    revision: 0, revisionId: null, local: "unchecked", localRevision: null,
    server: "loading", confirmedRevision: null, ready: false, error: null,
  };
  private current: CalpinageGeometry | null = null;
  private currentKey: string | null = null;
  private base: string | null = null;
  private baseKnown = false;
  private captureFailed = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | null = null;
  private listeners = new Set<(state: SaveState) => void>();

  constructor(private readonly deps: Dependencies) { this.scope = { ...deps.scope }; }
  getState = (): SaveState => ({ ...this.state });
  getGeometry = (): CalpinageGeometry | null => this.current ? copy(this.current) : null;
  hasGeometry = (): boolean => this.current != null;
  hasUnconfirmedChanges = (): boolean => this.captureFailed || (this.current != null && this.state.confirmedRevision !== this.state.revision);
  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => { this.listeners.delete(listener); };
  }
  private emit() { this.listeners.forEach((listener) => listener(this.getState())); }
  private cancelTimer() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }

  pause(conflict = false) {
    this.generation += 1;
    this.cancelTimer();
    this.state = { ...this.state, ready: false, server: conflict ? "conflict" : "loading" };
    this.emit();
  }

  adopt(geometry: CalpinageGeometry | null, source: "server" | "local" | "empty", serverRevision: string | null, serverAvailable: boolean) {
    this.generation += 1;
    this.cancelTimer();
    this.base = serverRevision;
    this.baseKnown = serverAvailable && (!geometry || serverRevision !== null);
    this.captureFailed = false;
    this.current = geometry ? copy(geometry) : null;
    this.currentKey = geometry ? contentKey(geometry) : null;
    this.state = {
      revision: 0, revisionId: geometry?.persistence?.revisionId ?? null,
      local: source === "local" ? "saved" : "unchecked", localRevision: source === "local" ? 0 : null,
      server: serverAvailable ? (source === "server" ? "confirmed" : "idle") : "failed",
      confirmedRevision: source === "server" && serverAvailable ? 0 : null,
      ready: true, error: serverAvailable ? null : "Serveur indisponible : version serveur non vérifiée.",
    };
    if (source === "local" && geometry) {
      // An unsynchronised local choice is an edit, even before the first UI action.
      this.currentKey = null;
      this.capture(geometry);
    } else this.emit();
  }

  capture(geometry: CalpinageGeometry): boolean {
    if (!this.state.ready || !geometry || typeof geometry !== "object") return false;
    try {
      const next = copy(geometry);
      const identity = next.persistence ?? next;
      if ((identity.studyId != null && String(identity.studyId) !== this.scope.studyId) ||
          (identity.versionId != null && String(identity.versionId) !== this.scope.versionId)) {
        throw new CalpinageSaveError("Le dessin reçu appartient à une autre étude ou version. Sauvegarde suspendue.", true);
      }
      const key = contentKey(next);
      this.captureFailed = false;
      if (key === this.currentKey) return true;
      const oldMetadata = this.current?.persistence;
      const revisionId = crypto.randomUUID();
      next.persistence = {
        schemaVersion: 1, ...this.scope, revisionId,
        baseServerRevisionId: this.baseKnown ? this.base : (oldMetadata?.acknowledgedServerRevisionId ?? oldMetadata?.baseServerRevisionId ?? null),
        modifiedAt: new Date().toISOString(),
      };
      this.current = next;
      this.currentKey = key;
      this.state = { ...this.state, revision: this.state.revision + 1, revisionId,
        server: this.state.server === "conflict" ? "conflict" : "pending", error: null };
      this.writeCurrentLocal();
      this.emit();
      this.cancelTimer();
      if (this.state.server !== "conflict") this.timer = setTimeout(() => { void this.flush(); }, this.deps.debounceMs ?? 3500);
      return true;
    } catch (error) {
      this.captureFailed = true;
      this.state = { ...this.state, local: "failed", server: error instanceof CalpinageSaveError && error.conflict ? "conflict" : "failed",
        error: error instanceof CalpinageSaveError ? error.message : "Les modifications ne peuvent pas être sérialisées. Gardez le calpinage ouvert." };
      this.emit();
      return false;
    }
  }

  private writeCurrentLocal(onlyIfOwned = false) {
    if (!this.current) return;
    try {
      // A late receipt from a disposed editor must never overwrite a newer editor's draft.
      if (onlyIfOwned) {
        const existing = this.deps.readLocal();
        if (existing?.persistence?.revisionId !== this.state.revisionId) return;
      }
      this.deps.writeLocal(copy(this.current));
      this.state.local = "saved";
      this.state.localRevision = this.state.revision;
    } catch {
      // setItem is atomic. Keep the previous useful copy; never clear storage to make room.
      this.state.local = "failed";
    }
  }

  private async verifyUnknownBase() {
    if (this.baseKnown) return;
    const generation = this.generation;
    const server = await this.deps.readServer();
    if (generation !== this.generation) throw new CalpinageSaveError("Le dessin a changé pendant la vérification serveur. Exportez le brouillon puis rechargez pour comparer.", true);
    const metadata = this.current?.persistence;
    if (server.geometry && !(server.serverRevision && metadata?.baseServerRevisionId === server.serverRevision)) {
      throw new CalpinageSaveError("La version serveur doit être comparée au brouillon. Exportez votre brouillon puis rechargez pour choisir la version à conserver.", true);
    }
    this.base = server.serverRevision;
    this.baseKnown = true;
  }

  /** Drain the latest captured revision. Never read the global runtime after an await. */
  flush = (): Promise<boolean> => {
    this.cancelTimer();
    if (this.running) return this.running;
    if (!this.state.ready || this.state.server === "conflict") return Promise.resolve(false);
    if (!this.hasUnconfirmedChanges()) return Promise.resolve(true);
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  };

  private async drain(): Promise<boolean> {
    try {
      if (this.captureFailed) throw new CalpinageSaveError("Les dernières modifications n’ont pas pu être capturées. Gardez le calpinage ouvert.");
      await this.verifyUnknownBase();
      while (this.current && this.hasUnconfirmedChanges()) {
        if (!this.state.ready) return false;
        if (this.captureFailed) throw new CalpinageSaveError("Les dernières modifications n’ont pas pu être capturées. Gardez le calpinage ouvert.");
        const sent = copy(this.current);
        const revision = this.state.revision;
        const generation = this.generation;
        sent.persistence.baseServerRevisionId = this.base;
        delete sent.persistence.acknowledgedServerRevisionId;
        this.state.server = "saving";
        this.state.error = null;
        this.emit();
        const receipt = await this.deps.post(sent, this.base);
        if (generation !== this.generation) {
          throw new CalpinageSaveError("Le dessin a été rechargé pendant une sauvegarde. Le nouveau brouillon est conservé ; rechargez après export pour vérifier la version serveur.", true);
        }
        const savedMeta = receipt.geometry?.persistence;
        if (!receipt.serverRevision || savedMeta?.revisionId !== sent.persistence.revisionId ||
            savedMeta.studyId !== this.scope.studyId || String(savedMeta.versionId) !== this.scope.versionId) {
          throw new CalpinageSaveError("Le serveur n’a pas confirmé cette révision. Gardez le calpinage ouvert puis réessayez.");
        }
        this.base = receipt.serverRevision;
        if (this.captureFailed) throw new CalpinageSaveError("Une version antérieure a été enregistrée, mais les dernières modifications n’ont pas pu être capturées. Gardez le calpinage ouvert.");
        this.state.confirmedRevision = revision;
        if (this.state.revision === revision && this.state.revisionId === sent.persistence.revisionId) {
          this.current.persistence.acknowledgedServerRevisionId = receipt.serverRevision;
          this.state.server = "confirmed";
          // Receipt only, never substitute an older POST's geometry for the current editor.
          this.writeCurrentLocal(true);
          this.emit();
          try { this.deps.onConfirmed?.(); } catch { /* An observer is not a persistence failure. */ }
        } else {
          this.current.persistence.baseServerRevisionId = receipt.serverRevision;
          this.state.server = "pending";
          this.writeCurrentLocal(true);
          this.emit();
        }
      }
      return !this.hasUnconfirmedChanges();
    } catch (error) {
      this.state.server = error instanceof CalpinageSaveError && error.conflict ? "conflict" : "failed";
      this.state.error = error instanceof Error ? error.message : "Sauvegarde serveur échouée.";
      this.emit();
      return false;
    }
  }
}
