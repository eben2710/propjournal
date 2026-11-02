export const PT = {
  ERROR_RES: 50,
  HEARTBEAT_EVENT: 51,
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  OA_ERROR_RES: 2142,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_RES: 2150,
  DEAL_LIST_REQ: 2133,
  DEAL_LIST_RES: 2134
} as const;

export const HOSTS = {
  demo: "wss://demo.ctraderapi.com:5035",
  live: "wss://live.ctraderapi.com:5035"
} as const;

export const TOKEN_ENDPOINT = "https://openapi.ctrader.com/apps/token";
export const AUTHORIZE_ENDPOINT =
  "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
export const CTRADER_SCOPE = "accounts";

export const DEAL_ACTION_FILLED = 2;
export const TRADE_SIDE_SELL = 2;

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: CTRADER_SCOPE,
    product: "web",
    state
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export function maskLogin(login: string | number | null | undefined): string {
  if (login == null || login === "") return "—";
  const s = String(login);
  return s.length <= 4 ? "•".repeat(s.length) : "•••" + s.slice(-4);
}

export class CtraderApiError extends Error {
  errorCode: string;
  retryAfterMs?: number;
  maintenanceEndMs?: number;

  constructor(
    errorCode: string,
    description?: string,
    retryAfterMs?: number,
    maintenanceEndMs?: number
  ) {
    super(description || errorCode);
    this.name = "CtraderApiError";
    this.errorCode = errorCode;
    this.retryAfterMs = retryAfterMs;
    this.maintenanceEndMs = maintenanceEndMs;
  }
}
