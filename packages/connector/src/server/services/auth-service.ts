import { createClient, type SupabaseClient, type User, type Session } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_SESSION_PATH } from "../config";
import { createLogger } from "../utils/logger";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const log = createLogger("AuthService");

const TRANSIENT_CODES = new Set([
  "CERT_NOT_YET_VALID",
  "CERT_HAS_EXPIRED",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const TRANSIENT_PATTERNS = [
  "cert_not_yet_valid",
  "certificate is not yet valid",
  "cert has expired",
  "enotfound",
  "econnrefused",
  "econnreset",
  "enetunreach",
  "eai_again",
  "etimedout",
  "fetch failed",
  "network request failed",
  "socket hang up",
  "und_err",
];

const DEFINITIVE_PATTERNS = [
  "refresh_token_not_found",
  "invalid_grant",
  "invalid_token",
  "session_not_found",
  "user_not_found",
  "invalid refresh token",
];

function extractErrorCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: { code?: unknown } }).cause;
  if (cause && typeof cause === "object" && typeof cause.code === "string") return cause.code;
  return "";
}

export function isTransientAuthError(err: unknown): boolean {
  if (!err) return false;
  const code = extractErrorCode(err);
  if (code && TRANSIENT_CODES.has(code)) return true;
  const name = (err as { name?: string })?.name ?? "";
  if (name === "AuthRetryableFetchError") return true;
  const status = (err as { status?: number })?.status;
  if (typeof status === "number" && (status === 0 || status === 429 || status >= 500)) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}

export function isDefinitiveAuthError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 400) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (DEFINITIVE_PATTERNS.some((p) => msg.includes(p))) return true;
    if (status === 401 || status === 403) return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return DEFINITIVE_PATTERNS.some((p) => msg.includes(p));
}

export class AuthService {
  private supabase: SupabaseClient;
  private _currentUser: User | null = null;
  private _session: Session | null = null;
  private _isInitializing = true;
  private stateChangeCallbacks: ((user: User | null) => void)[] = [];
  private supabaseSubscription: { unsubscribe: () => void } | null = null;
  private restoreRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private restoreCancelled = false;
  private restoreGeneration = 0;

  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    this.setupAuthStateListener();
  }

  async initialize(): Promise<void> {
    await this.restoreSession();
  }

  get currentUser(): User | null {
    return this._currentUser;
  }

  get session(): Session | null {
    return this._session;
  }

  get isInitializing(): boolean {
    return this._isInitializing;
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  onAuthStateChange(callback: (user: User | null) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  private notifyStateChange(): void {
    for (const cb of this.stateChangeCallbacks) {
      cb(this._currentUser);
    }
  }

  private setupAuthStateListener(): void {
    const { data } = this.supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (event === "TOKEN_REFRESHED" && session) {
          log.info("Supabase token auto-refreshed, persisting new session");
          this._session = session;
          this._currentUser = session.user;
          this.persistSession();
        } else if (event === "SIGNED_OUT") {
          log.info("Supabase signed out (detected via auth state listener)");
          this.cancelRestoreRetry();
          this._session = null;
          this._currentUser = null;
          this._isInitializing = false;
          this.clearPersistedSession();
          this.notifyStateChange();
        }
      }, 0);
    });
    this.supabaseSubscription = data.subscription;
  }

  destroy(): void {
    this.restoreCancelled = true;
    if (this.restoreRetryTimer) {
      clearTimeout(this.restoreRetryTimer);
      this.restoreRetryTimer = null;
    }
    this.supabaseSubscription?.unsubscribe();
    this.supabaseSubscription = null;
  }

  private async restoreSession(): Promise<void> {
    if (!existsSync(AUTH_SESSION_PATH)) {
      this._isInitializing = false;
      this.notifyStateChange();
      return;
    }

    let saved: { access_token: string; refresh_token: string };
    try {
      const raw = readFileSync(AUTH_SESSION_PATH, "utf-8");
      saved = JSON.parse(raw) as { access_token: string; refresh_token: string };
      if (!saved.access_token || !saved.refresh_token) {
        log.warn("Persisted session is missing tokens; ignoring");
        this._isInitializing = false;
        this.notifyStateChange();
        return;
      }
    } catch (err) {
      log.warn(`Persisted session file is unreadable; ignoring: ${err}`);
      this._isInitializing = false;
      this.notifyStateChange();
      return;
    }

    const generation = ++this.restoreGeneration;
    await this.attemptRestore(saved, 0, generation);
  }

  private async attemptRestore(
    saved: { access_token: string; refresh_token: string },
    attempt: number,
    generation: number
  ): Promise<void> {
    if (this.restoreCancelled || generation !== this.restoreGeneration) return;

    try {
      const { data: sessionData, error } = await this.supabase.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      });

      if (this.restoreCancelled || generation !== this.restoreGeneration) return;

      if (!error && sessionData.session) {
        this._session = sessionData.session;
        this._currentUser = sessionData.session.user;
        this.persistSession();
        const suffix = attempt > 0 ? ` (after ${attempt} retries)` : "";
        log.info(`Restored session for user: ${this._currentUser.id}${suffix}`);
        this._isInitializing = false;
        this.notifyStateChange();
        return;
      }

      if (isDefinitiveAuthError(error)) {
        log.warn(`Persisted session rejected by Supabase: ${error?.message ?? "unknown"}`);
        this._isInitializing = false;
        this.notifyStateChange();
        return;
      }

      const reason = error?.message ?? "no session returned";
      log.warn(`restoreSession attempt ${attempt + 1} returned recoverable error: ${reason} — will retry`);
      this.scheduleRestoreRetry(saved, attempt, generation);
    } catch (err) {
      if (this.restoreCancelled || generation !== this.restoreGeneration) return;

      if (isDefinitiveAuthError(err)) {
        log.warn(`restoreSession definitive failure: ${err}`);
        this._isInitializing = false;
        this.notifyStateChange();
        return;
      }

      if (isTransientAuthError(err)) {
        log.warn(`restoreSession attempt ${attempt + 1} transient (network/TLS): ${err} — will retry`);
        this.scheduleRestoreRetry(saved, attempt, generation);
        return;
      }

      log.warn(`restoreSession attempt ${attempt + 1} unknown error, treating as transient: ${err}`);
      this.scheduleRestoreRetry(saved, attempt, generation);
    }
  }

  private scheduleRestoreRetry(
    saved: { access_token: string; refresh_token: string },
    attempt: number,
    generation: number
  ): void {
    if (this.restoreCancelled || generation !== this.restoreGeneration) return;
    const delayMs = Math.min(60_000, 5_000 * 2 ** Math.min(attempt, 4));
    if (this.restoreRetryTimer) {
      clearTimeout(this.restoreRetryTimer);
    }
    this.restoreRetryTimer = setTimeout(() => {
      this.restoreRetryTimer = null;
      this.attemptRestore(saved, attempt + 1, generation).catch((err) =>
        log.error(`attemptRestore threw unexpectedly: ${err}`)
      );
    }, delayMs);
  }

  private cancelRestoreRetry(): void {
    this.restoreGeneration++;
    if (this.restoreRetryTimer) {
      clearTimeout(this.restoreRetryTimer);
      this.restoreRetryTimer = null;
    }
  }

  private persistSession(): void {
    if (!this._session) return;
    try {
      const dir = dirname(AUTH_SESSION_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        AUTH_SESSION_PATH,
        JSON.stringify({
          access_token: this._session.access_token,
          refresh_token: this._session.refresh_token,
        })
      );
    } catch (err) {
      log.warn(`Failed to persist session: ${err}`);
    }
  }

  private clearPersistedSession(): void {
    try {
      if (existsSync(AUTH_SESSION_PATH)) {
        const { unlinkSync } = require("fs");
        unlinkSync(AUTH_SESSION_PATH);
      }
    } catch {}
  }

  async setSessionFromTokens(
    accessToken: string,
    refreshToken: string
  ): Promise<{ user: User | null; error: string | null }> {
    const { data, error } = await this.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      return { user: null, error: error.message };
    }
    this.cancelRestoreRetry();
    this._session = data.session;
    this._currentUser = data.session?.user ?? null;
    this._isInitializing = false;
    if (this._session) {
      this.persistSession();
    }
    this.notifyStateChange();
    return { user: this._currentUser, error: null };
  }

  async signOut(): Promise<{ error: string | null }> {
    this.cancelRestoreRetry();
    const { error } = await this.supabase.auth.signOut();
    this._session = null;
    this._currentUser = null;
    this._isInitializing = false;
    this.clearPersistedSession();
    this.notifyStateChange();
    return { error: error?.message ?? null };
  }

  async deleteAccount(): Promise<{ error: string | null }> {
    if (!this._currentUser || !this._session) return { error: "Not authenticated" };

    const userId = this._currentUser.id;
    const accessToken = this._session.access_token;

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ userId }),
      });

      if (response.status < 200 || response.status >= 300) {
        if (response.status === 404) {
          return { error: "Account deletion is not yet available. Please try again later." };
        }
        try {
          const body = (await response.json()) as { message?: string; error?: string };
          const message = body.message ?? body.error;
          if (message && message.length > 0) {
            return { error: message };
          }
        } catch {}
        return { error: "Unable to delete your account right now." };
      }

      await this.signOut();
      return { error: null };
    } catch (err: any) {
      log.warn(`Delete account request failed: ${err}`);
      return { error: err?.message ?? "Unable to delete your account right now." };
    }
  }

  getStatus(): {
    authenticated: boolean;
    user: Partial<User> | null;
    passwordResetPending: boolean;
    isInitializing: boolean;
  } {
    return {
      authenticated: !!this._currentUser,
      user: this._currentUser
        ? { id: this._currentUser.id, email: this._currentUser.email }
        : null,
      passwordResetPending: false,
      isInitializing: this._isInitializing,
    };
  }
}
