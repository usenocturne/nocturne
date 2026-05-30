import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import { encrypt, decrypt } from "../utils/encryption";
import { createLogger } from "../utils/logger";

const log = createLogger("SpotifyDatabase");

export interface SpotifyDatabaseCredentials {
  accessToken: string;
  refreshToken: string;
  scope: string | null;
  tokenType: string;
  accessTokenExpiresAt: Date;
}

export class SpotifyDatabaseStorage {
  private supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    this.supabase =
      supabase ?? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  }

  async saveCredentials(
    accessToken: string,
    refreshToken: string,
    scope: string | null,
    tokenType: string,
    expiresAt: Date,
    userID: string
  ): Promise<void> {
    const encryptedAccessToken = encrypt(accessToken, userID);
    const encryptedRefreshToken = encrypt(refreshToken, userID);

    const payload = {
      user_id: userID,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      scope: scope ?? "",
      token_type: tokenType,
      access_token_expires_at: expiresAt.toISOString(),
    };

    const { error } = await this.supabase
      .from("spotify_credentials")
      .upsert(payload, { onConflict: "user_id" });

    if (error) throw new Error(`Database error: ${error.message}`);
    log.info("Saved Spotify credentials for user");
  }

  async loadCredentials(userID: string): Promise<SpotifyDatabaseCredentials> {
    const query = async (): Promise<SpotifyDatabaseCredentials> => {
      const { data, error } = await this.supabase
        .from("spotify_credentials")
        .select()
        .eq("user_id", userID);

      if (error) throw new Error(`Database error: ${error.message}`);
      if (!data || data.length === 0) throw new Error("No credentials found");

      const row = data[0];
      const decryptedAccessToken = decrypt(row.access_token, userID);
      const decryptedRefreshToken = decrypt(row.refresh_token, userID);
      const expiresAt = new Date(row.access_token_expires_at);

      if (isNaN(expiresAt.getTime())) throw new Error("Invalid expiration date format");

      return {
        accessToken: decryptedAccessToken,
        refreshToken: decryptedRefreshToken,
        scope: row.scope || null,
        tokenType: row.token_type,
        accessTokenExpiresAt: expiresAt,
      };
    };

    const timeoutMs = 10_000;
    const result = await Promise.race([
      query(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Database query timeout after 10 seconds")), timeoutMs)
      ),
    ]);

    return result;
  }

  async deleteCredentials(userID: string): Promise<void> {
    const { error } = await this.supabase
      .from("spotify_credentials")
      .delete()
      .eq("user_id", userID);

    if (error) throw new Error(`Database error: ${error.message}`);
  }
}
