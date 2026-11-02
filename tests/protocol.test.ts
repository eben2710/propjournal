import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  maskLogin,
  PT,
  CtraderApiError
} from "../lib/ctrader/protocol";

describe("protocol constants (verified against spotware/openapi-proto-messages)", () => {
  it("uses the official payload type numbers", () => {
    expect(PT.APPLICATION_AUTH_REQ).toBe(2100);
    expect(PT.ACCOUNT_AUTH_REQ).toBe(2102);
    expect(PT.SYMBOLS_LIST_REQ).toBe(2114);
    expect(PT.DEAL_LIST_REQ).toBe(2133);
    expect(PT.DEAL_LIST_RES).toBe(2134);
    expect(PT.OA_ERROR_RES).toBe(2142);
    expect(PT.ACCOUNTS_TOKEN_INVALIDATED_EVENT).toBe(2147);
    expect(PT.GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_REQ).toBe(2149);
    expect(PT.GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_RES).toBe(2150);
    expect(PT.ERROR_RES).toBe(50);
    expect(PT.HEARTBEAT_EVENT).toBe(51);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds the official authorization URL with view-only scope", () => {
    const url = buildAuthorizeUrl("cid123", "https://app.example.com/api/ctrader/callback", "st4te");
    expect(url.startsWith("https://id.ctrader.com/my/settings/openapi/grantingaccess/")).toBe(true);
    expect(url).toContain("client_id=cid123");
    expect(url).toContain("scope=accounts");
    expect(url).toContain("product=web");
    expect(url).toContain("state=st4te");
    expect(url).toContain("redirect_uri=" + encodeURIComponent("https://app.example.com/api/ctrader/callback"));
  });
});

describe("maskLogin", () => {
  it("masks everything but the last 4 characters", () => {
    expect(maskLogin(5211234)).toBe("•••1234");
    expect(maskLogin("5211234")).toBe("•••1234");
    expect(maskLogin("123")).toBe("•••");
    expect(maskLogin(null)).toBe("—");
    expect(maskLogin(undefined)).toBe("—");
  });
});

describe("CtraderApiError", () => {
  it("carries retry and maintenance hints", () => {
    const err = new CtraderApiError("CH_RATE_LIMIT", "slow down", 2000, 1700000000000);
    expect(err.errorCode).toBe("CH_RATE_LIMIT");
    expect(err.retryAfterMs).toBe(2000);
    expect(err.maintenanceEndMs).toBe(1700000000000);
  });
});
