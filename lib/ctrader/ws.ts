import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { CtraderApiError, PT } from "./protocol";

interface Pending {
  resolve: (value: any) => void;
  reject: (err: CtraderApiError) => void;
  timer: NodeJS.Timeout;
}

export interface ConnectOptions {
  url: string;
  clientId: string;
  clientSecret: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  onTokenInvalidated?: () => void;
}

export const OAUTH_STATE_COOKIE = "pj_oauth_state";

export class CtraderClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private hbTimer: NodeJS.Timeout | null = null;
  private requestTimeoutMs: number = 20000;
  onTokenInvalidated?: () => void;

  private constructor() {}

  static async connect(opts: ConnectOptions): Promise<CtraderClient> {
    const client = new CtraderClient();
    client.requestTimeoutMs = opts.requestTimeoutMs ?? 20000;
    client.onTokenInvalidated = opts.onTokenInvalidated;
    const connectTimeout = opts.connectTimeoutMs ?? 15000;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(opts.url, { handshakeTimeout: connectTimeout });
      client.ws = ws;
      const timer = setTimeout(() => {
        try { ws.terminate(); } catch {}
        reject(new CtraderApiError("CONNECT_TIMEOUT", "Timed out connecting to cTrader"));
      }, connectTimeout);
      ws.on("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (e: Error) => {
        clearTimeout(timer);
        reject(new CtraderApiError("CONNECT_FAILED", `cTrader connection failed: ${e.message}`));
      });
      ws.on("message", (data) => client.handleMessage(String(data)));
      ws.on("close", () => client.failAllPending("DISCONNECTED", "cTrader connection closed"));
    });
    client.startHeartbeat();
    await client.request(PT.APPLICATION_AUTH_REQ, {
      clientId: opts.clientId,
      clientSecret: opts.clientSecret
    });
    return client;
  }

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const pt = Number(msg.payloadType);
    if (pt === PT.HEARTBEAT_EVENT) return;
    if (pt === PT.ACCOUNTS_TOKEN_INVALIDATED_EVENT) {
      this.onTokenInvalidated?.();
      return;
    }
    if (pt === PT.ERROR_RES || pt === PT.OA_ERROR_RES) {
      const p = msg.payload ?? {};
      const err = new CtraderApiError(
        String(p.errorCode ?? "UNKNOWN_ERROR"),
        p.description ?? "cTrader request failed",
        p.retryAfter != null ? Number(p.retryAfter) : undefined,
        p.maintenanceEndTimestamp != null ? Number(p.maintenanceEndTimestamp) : undefined
      );
      const oldestKey = this.pending.keys().next();
      if (!oldestKey.done) {
        const pending = this.pending.get(oldestKey.value)!;
        this.pending.delete(oldestKey.value);
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      return;
    }
    const id = msg.clientMsgId ? String(msg.clientMsgId) : null;
    if (id && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.resolve(msg.payload ?? {});
    }
  }

  request(payloadType: number, payload: Record<string, unknown>): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new CtraderApiError("NOT_CONNECTED", "cTrader socket is not open"));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CtraderApiError("TIMEOUT", `cTrader request ${payloadType} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ clientMsgId: id, payloadType, payload }));
    });
  }

  private startHeartbeat(): void {
    this.hbTimer = setInterval(() => {
      try {
        this.ws?.send(JSON.stringify({ payloadType: PT.HEARTBEAT_EVENT }));
      } catch {}
    }, 9000);
    if (this.hbTimer.unref) this.hbTimer.unref();
  }

  private failAllPending(code: string, message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new CtraderApiError(code, message));
      this.pending.delete(id);
    }
  }

  async close(): Promise<void> {
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.failAllPending("DISCONNECTED", "Client closed");
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      ws.once("close", done);
      try {
        ws.close();
      } catch {
        done();
      }
      setTimeout(done, 2000).unref?.();
    });
  }
}

export async function openAccountSession(opts: {
  isLive: boolean;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  ctidTraderAccountId: string | number;
  onTokenInvalidated?: () => void;
}): Promise<CtraderClient> {
  const url = opts.isLive ? "wss://live.ctraderapi.com:5035" : "wss://demo.ctraderapi.com:5035";
  const client = await CtraderClient.connect({
    url,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    onTokenInvalidated: opts.onTokenInvalidated
  });
  try {
    await client.request(PT.ACCOUNT_AUTH_REQ, {
      ctidTraderAccountId: String(opts.ctidTraderAccountId),
      accessToken: opts.accessToken
    });
  } catch (err) {
    await client.close();
    throw err;
  }
  return client;
}
