import { Elysia, t } from "elysia";
import type { AnalyticsService } from "../services/analytics-service";

export function createAnalyticsRoutes(analyticsService: AnalyticsService) {
  return new Elysia({ prefix: "/api/analytics" })
    .get("/status", () => ({ enabled: analyticsService.isEnabled }))
    .post(
      "/enabled",
      ({ body }) => {
        analyticsService.setEnabled(body.enabled);
        return { enabled: analyticsService.isEnabled };
      },
      {
        body: t.Object({
          enabled: t.Boolean(),
        }),
      }
    );
}
