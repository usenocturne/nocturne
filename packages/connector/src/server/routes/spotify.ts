import { Elysia } from "elysia";
import type { SpotifyService } from "../services/spotify-service";

export function createSpotifyRoutes(spotify: SpotifyService) {
  return new Elysia({ prefix: "/api/spotify" })
    .get("/status", () => {
      return { authState: spotify.authState };
    })
    .post("/authorize", async () => {
      await spotify.startDeviceAuthorization();
      return { success: true, authState: spotify.authState };
    })
    .post("/cancel", () => {
      spotify.cancelAuthorization();
      return { success: true };
    })
    .post("/disconnect", async () => {
      await spotify.disconnect();
      return { success: true };
    });
}
