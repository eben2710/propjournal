import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { getDb } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { requiredEnv, appOrigin, isConfigured } from "../../lib/env";
import { buildAuthorizeUrl } from "../../lib/ctrader/protocol";
import { errorResponse, HttpError } from "../../lib/http";

export const OAUTH_STATE_COOKIE = "pj_oauth_state";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET, OPTIONS");
      return res.status(204).end();
    }
    if (req.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "Use GET");
    }
    const q = getDb();
    await requireUser(q, req);

    if (!isConfigured("CTRADER_CLIENT_ID") || !isConfigured("CTRADER_CLIENT_SECRET")) {
      throw new HttpError(
        501,
        "not_configured",
        "The server has no cTrader API credentials yet. The owner must register an app at openapi.ctrader.com and set CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET."
      );
    }
    const app = appOrigin();
    if (!app) {
      throw new HttpError(500, "not_configured", "APP_URL is not set on the server.");
    }

    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = `${app}/api/ctrader/callback`;
    const url = buildAuthorizeUrl(requiredEnv("CTRADER_CLIENT_ID"), redirectUri, state);

    res.setHeader(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    );
    res.redirect(302, url);
  } catch (err) {
    const anyErr = err as any;
    if (anyErr instanceof HttpError) {
      return res.redirect(302, `/?ctrader=error&reason=${encodeURIComponent(anyErr.message)}`);
    }
    errorResponse(res, err);
  }
}
