import type { Article } from '../types/gdelt';
import { createUpstreamGate, type UpstreamGate } from './upstreamGate';

/**
 * Only two DOC modes are used: artlist (coverage) and timelinevol (trends).
 * The API offers more — add them back when a caller actually needs one.
 */
export type GdeltMode = 'artlist' | 'timelinevol';

export type SortOrder = 'DateDesc' | 'DateAsc' | 'ToneDesc' | 'ToneAsc';

export const TIMESPAN_PATTERN = /^(\d+[mhdw]|3m)$/;

const SORT_ORDERS: readonly SortOrder[] = ['DateDesc', 'DateAsc', 'ToneDesc', 'ToneAsc'];

/** Whitelist-parse untrusted input (DB rows) into a SortOrder. */
export function parseSort(value: string | null | undefined): SortOrder | undefined {
  return SORT_ORDERS.find((s) => s === value);
}

export function isValidTimespan(value: string): boolean {
  return TIMESPAN_PATTERN.test(value);
}

export interface GdeltSearchParams {
  query: string;
  mode?: GdeltMode;
  timespan?: string;
  maxrecords?: number;
  sort?: SortOrder;
}

export interface GdeltResponse {
  status: 'OK' | 'ERROR';
  totalResults: number;
  timespan: string;
  query: string;
  articles: Article[];
  error?: string;
}

const GDELT_HOSTS = [
  'https://api.gdeltproject.org',
  'https://api-backup.gdeltproject.org',
] as const;

// GDELT intermittently blocks non-browser user agents (community-documented).
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20_000;

/**
 * GDELT's throttle arrives as HTTP 200 plain text, not a 429.
 * Markers are lowercase — matching lowercases the response prefix first.
 */
export const THROTTLE_MARKERS = [
  'please limit requests to one every 5 seconds',
  'rate limit',
];

export class GdeltRateLimitError extends Error {
  constructor(message = 'GDELT rate limited this client') {
    super(message);
    this.name = 'GdeltRateLimitError';
  }
}

export function buildParams({
  query,
  mode = 'artlist',
  timespan,
  maxrecords = 75,
  sort = 'DateDesc',
}: GdeltSearchParams): URLSearchParams {
  if (query.length < 3 || query.length > 1000) {
    throw new Error('Query must be between 3 and 1000 characters');
  }

  if (timespan && !isValidTimespan(timespan)) {
    throw new Error('Invalid timespan format');
  }

  if (maxrecords < 1 || maxrecords > 250) {
    throw new Error('maxrecords must be between 1 and 250');
  }

  const params = new URLSearchParams({
    query,
    mode,
    format: 'json',
    maxrecords: maxrecords.toString(),
    sort,
  });

  if (timespan) params.append('timespan', timespan);
  return params;
}

function isThrottleText(text: string): boolean {
  const lower = text.slice(0, 400).toLowerCase();
  return THROTTLE_MARKERS.some((m) => lower.includes(m));
}

/**
 * The upstream seam: gate + transport are injected, so the failure modes
 * that matter (HTTP-200 throttle text, host failover, fast-fail cooldown)
 * are testable through the same interface callers use.
 */
export interface GdeltApiDeps {
  gate?: UpstreamGate;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type GdeltApiClient = {
  searchArticles(params: GdeltSearchParams): Promise<GdeltResponse>;
  volumeTimeline(query: string, timespan?: string): Promise<unknown>;
};

export function createGdeltApi(deps: GdeltApiDeps = {}): GdeltApiClient {
  const gate = deps.gate ?? createUpstreamGate();
  const doFetch = deps.fetchImpl ?? fetch.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;

  async function fetchRaw(params: URLSearchParams): Promise<unknown> {
    try {
      await gate.acquire();
    } catch {
      throw new GdeltRateLimitError('GDELT in throttle cooldown — failing fast');
    }

    let lastError: Error = new Error('GDELT request never attempted');

    for (const host of GDELT_HOSTS) {
      const url = `${host}/api/v2/doc/doc?${params.toString()}`;
      try {
        const response = await doFetch(url, {
          headers: { 'User-Agent': BROWSER_UA },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status === 429) {
          gate.markThrottled();
          throw new GdeltRateLimitError();
        }

        const contentType = response.headers.get('content-type') || '';
        const rawText =
          contentType.includes('application/json') ? null : await response.text();

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${host}`);
        }
        if (rawText !== null) {
          if (isThrottleText(rawText)) {
            gate.markThrottled();
            throw new GdeltRateLimitError();
          }
          throw new Error(`Non-JSON response: ${rawText.slice(0, 120)}`);
        }

        return (await response.json()) as unknown;
      } catch (error) {
        if (error instanceof GdeltRateLimitError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        // try backup host on anything else (timeout, 5xx, network)
      }
    }

    throw lastError;
  }

  return {
    /** Artlist search returning typed articles. */
    async searchArticles(params: GdeltSearchParams): Promise<GdeltResponse> {
      const data = (await fetchRaw(buildParams(params))) as Partial<GdeltResponse>;

      if (data.status === 'ERROR') {
        throw new Error(data.error || 'Unknown API error');
      }

      return {
        status: 'OK',
        totalResults: data.totalResults ?? 0,
        timespan: data.timespan ?? '',
        query: data.query ?? params.query,
        articles: data.articles ?? [],
      };
    },

    /**
     * Volume-intensity timeline from DOC timelinevol mode. Same validation
     * and failover path as artlist — callers parse the lenient shape.
     */
    async volumeTimeline(query: string, timespan = '3m'): Promise<unknown> {
      return fetchRaw(buildParams({ query, mode: 'timelinevol', timespan }));
    },
  };
}

/** Live composition — the isolate-wide gate paces every caller automatically. */
export const gdeltApi = createGdeltApi();
