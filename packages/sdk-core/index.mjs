export class UsefulWaitingApiError extends Error {
  constructor(status, message, details = {}) { super(message); this.name = "UsefulWaitingApiError"; this.status = status; this.code = details.code; this.eligibility = details.eligibility; }
}
export class PendingAdjudicationError extends UsefulWaitingApiError {}
export class GenLayerNotConfiguredError extends UsefulWaitingApiError {}
export class GenLayerRequestFailedError extends UsefulWaitingApiError {}

function apiError(status, message, details) {
  const Type = ({ pending_adjudication: PendingAdjudicationError, genlayer_not_configured: GenLayerNotConfiguredError,
    genlayer_request_failed: GenLayerRequestFailedError })[details?.code] || UsefulWaitingApiError;
  return new Type(status, message, details);
}

export class UsefulWaitingClient {
  constructor({ baseUrl = "http://127.0.0.1:8787", apiKey, timeoutMs = 10000, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); this.apiKey = apiKey; this.timeoutMs = timeoutMs; this.fetch = fetchImpl;
  }
  async request(path, { method = "GET", body, allowedStatuses = [] } = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, { method, signal: controller.signal, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && !allowedStatuses.includes(response.status)) throw apiError(response.status, payload.error || `API request failed with ${response.status}.`, payload);
      return { status: response.status, body: payload };
    } catch (error) {
      if (error.name === "AbortError") throw new UsefulWaitingApiError(408, `API request timed out after ${this.timeoutMs}ms.`);
      throw error;
    } finally { clearTimeout(timer); }
  }
  health() { return this.request("/health").then(({ body }) => body); }
}

export function redactApiKey(value) { return value ? `${String(value).slice(0, 8)}...redacted` : null; }
