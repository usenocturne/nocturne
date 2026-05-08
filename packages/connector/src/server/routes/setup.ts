import { Elysia } from "elysia";
import type { SetupStateService } from "../services/setup-state-service";

export function createSetupRoutes(setupStateService: SetupStateService) {
  return new Elysia({ prefix: "/api/setup" })
    .post("/complete", () => {
      try {
        const result = setupStateService.markComplete();
        return { success: true, completedAt: result.completedAt };
      } catch (err: any) {
        return { error: err?.message ?? "Failed to mark setup complete" };
      }
    })
    .get("/status", () => ({ complete: setupStateService.isComplete() }));
}
