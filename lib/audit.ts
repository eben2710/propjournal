import type { Query } from "./db";
import { ipHash } from "./http";

export interface AuditInput {
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

export async function audit(q: Query, input: AuditInput): Promise<void> {
  try {
    await q(
      `INSERT INTO audit_events (user_id, action, detail, ip_hash) VALUES ($1, $2, $3, $4)`,
      [
        input.userId ?? null,
        input.action,
        input.detail ? JSON.stringify(input.detail) : null,
        input.ip ? ipHash(input.ip) : null
      ]
    );
  } catch (err) {
    console.error("audit write failed:", (err as Error).message);
  }
}
