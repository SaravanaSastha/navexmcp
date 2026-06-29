import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  navexBaseUrl: z.string().url(),
  navexServiceUsername: z.string().optional(),
  navexServicePassword: z.string().optional(),
  apiKeys: z.array(z.string().min(16)).default([]),
  port: z.coerce.number().int().positive().default(3000),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  sessionIdleTtlMs: z.coerce.number().int().positive().default(15 * 60_000),
  sessionPingIntervalMs: z.coerce.number().int().positive().default(5 * 60_000),
  metadataCacheTtlMs: z.coerce.number().int().positive().default(10 * 60_000),
  navexMaxConcurrent: z.coerce.number().int().positive().default(4),
  navexRetryMax: z.coerce.number().int().min(0).default(3),
  /** LDAP Profile ID for LDAP/SSO-backed NAVEX accounts (PDF: Login ldapSettingsId). */
  navexLdapSettingsId: z.coerce.number().int().positive().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    navexBaseUrl: env.NAVEX_BASE_URL,
    navexServiceUsername: env.NAVEX_SERVICE_USERNAME || undefined,
    navexServicePassword: env.NAVEX_SERVICE_PASSWORD || undefined,
    apiKeys: (env.API_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    sessionIdleTtlMs: env.SESSION_IDLE_TTL_MS,
    sessionPingIntervalMs: env.SESSION_PING_INTERVAL_MS,
    metadataCacheTtlMs: env.METADATA_CACHE_TTL_MS,
    navexMaxConcurrent: env.NAVEX_MAX_CONCURRENT,
    navexRetryMax: env.NAVEX_RETRY_MAX,
    navexLdapSettingsId: env.NAVEX_LDAP_SETTINGS_ID || undefined,
  });
  if (!parsed.success) {
    // Never echo raw env values in errors.
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration for: ${fields}. Check your environment variables.`);
  }
  const cfg = parsed.data;
  // Strict-auth invariant: API keys are an opt-in that requires a service account.
  if (cfg.apiKeys.length > 0 && (!cfg.navexServiceUsername || !cfg.navexServicePassword)) {
    throw new Error(
      "API_KEYS is set but NAVEX_SERVICE_USERNAME/NAVEX_SERVICE_PASSWORD are not. " +
        "Either configure the service account or remove API_KEYS (Basic auth is the default).",
    );
  }
  return cfg;
}
