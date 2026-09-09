const REQUIRED = ["RA_BASE_URL", "RA_COMPANY_CODE", "RA_USERNAME", "RA_PASSWORD"] as const;

function read(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v.trim();
}

export type AppInterface = "sa" | "ss" | "admin";

/**
 * Values are read on access rather than at import, so importing a module that merely mentions
 * config does not require a configured environment. Call assertConfig() for fail-fast startup.
 */
export const config = {
  ra: {
    /** Includes the /portal prefix, e.g. https://qa-develop.rightanswers.com/portal */
    get baseUrl() {
      return read("RA_BASE_URL").replace(/\/+$/, "");
    },
    get companyCode() {
      return read("RA_COMPANY_CODE");
    },
    get appInterface(): AppInterface {
      return (process.env.RA_APP_INTERFACE ?? "sa") as AppInterface;
    },
    get username() {
      return read("RA_USERNAME");
    },
    get password() {
      return read("RA_PASSWORD");
    },
    get timeoutMs() {
      return Number(process.env.RA_TIMEOUT_MS ?? 30_000);
    },
  },
  openai: {
    get apiKey() {
      return process.env.OPENAI_API_KEY ?? "";
    },
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
};

export function assertConfig(): void {
  for (const key of REQUIRED) read(key);
}
