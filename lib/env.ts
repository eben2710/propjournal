export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function appOrigin(): string {
  return (process.env.APP_URL || "").replace(/\/+$/, "");
}

export function isConfigured(name: string): boolean {
  return !!process.env[name];
}
