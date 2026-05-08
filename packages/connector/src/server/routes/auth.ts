import { Elysia, t } from "elysia";
import { NOCTURNE_SITE_URL } from "../config";
import { createLogger } from "../utils/logger";
import type { AuthService } from "../services/auth-service";
import type { SetupStateService } from "../services/setup-state-service";

const log = createLogger("routes:auth");

export function createAuthRoutes(authService: AuthService, setupStateService: SetupStateService) {
  return new Elysia({ prefix: "/api/auth" })
    .get("/status", () => ({
      ...authService.getStatus(),
      setupComplete: setupStateService.isComplete(),
    }))
    .post("/signout", async () => {
      const result = await authService.signOut();
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true };
    })
    .post("/delete-account", async ({ set }) => {
      const result = await authService.deleteAccount();
      if (result.error) {
        set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true };
    })
    .post(
      "/pair",
      async ({ body, set }) => {
        const { code } = body;
        try {
          const res = await fetch(`${NOCTURNE_SITE_URL}/api/pair/redeem`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            access_token?: string;
            refresh_token?: string;
            error?: string;
          };
          if (!res.ok || !data.access_token || !data.refresh_token) {
            set.status = res.status >= 400 && res.status < 600 ? res.status : 502;
            return { error: data.error ?? "Failed to redeem code" };
          }
          const result = await authService.setSessionFromTokens(
            data.access_token,
            data.refresh_token
          );
          if (result.error) {
            log.error("pair: setSessionFromTokens failed", { err: result.error });
            set.status = 500;
            return { error: result.error };
          }
          return {
            success: true,
            user: result.user ? { id: result.user.id, email: result.user.email } : null,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Pairing request failed";
          log.error("pair: fetch failed", { err: msg });
          set.status = 502;
          return { error: msg };
        }
      },
      {
        body: t.Object({
          code: t.String({ minLength: 1 }),
        }),
      }
    );
}
