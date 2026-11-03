import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorResponse } from "../lib/http";
import { handleAuth } from "../lib/routes/auth";
import { handleJournal } from "../lib/routes/journal";
import { handleCtrader } from "../lib/routes/ctrader";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const raw = req.query.path;
    const parts = (Array.isArray(raw) ? raw : [raw ?? ""])
      .join("/")
      .split("/")
      .filter(Boolean);
    switch (parts[0]) {
      case "auth":
        return await handleAuth(req, res, parts.slice(1));
      case "journal":
        return await handleJournal(req, res, parts.slice(1));
      case "ctrader":
        return await handleCtrader(req, res, parts.slice(1));
      default:
        return res.status(404).json({ error: "not_found", message: "Unknown API route" });
    }
  } catch (err) {
    errorResponse(res, err);
  }
}
