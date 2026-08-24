import type { Article } from '../types/gdelt';

export type GdeltMode =
  | 'artlist'
  | 'artgallery'
  | 'timelinevol'
  | 'tonechart'
  | 'wordcloudimagetags'
  | 'imagecollage'
  | 'imagegallery'
  | 'timelinelang'
  | 'timelinesourcecountry';

export type GdeltFormat = 'html' | 'csv' | 'rss' | 'json' | 'jsonp';
export type SortOrder = 'DateDesc' | 'DateAsc' | 'ToneDesc' | 'ToneAsc';

export const TIMESPAN_PATTERN = /^(\d+[mhdw]|3m)$/;

const SORT_ORDERS: readonly SortOrder[] = ['DateDesc', 'DateAsc', 'ToneDesc', 'ToneAsc'];
const MODES: readonly GdeltMode[] = [
  'artlist',
  'artgallery',
  'timelinevol',
  'tonechart',
  'wordcloudimagetags',
  'imagecollage',
  'imagegallery',
  'timelinelang',
  'timelinesourcecountry',
];

/** Whitelist-parse untrusted input (DB rows, form fields) into a SortOrder. */
export function parseSort(value: string | null | undefined): SortOrder | undefined {
  return SORT_ORDERS.find((s) => s === value);
}

/** Whitelist-parse untrusted input (DB rows, form fields) into a GdeltMode. */
export function parseMode(value: string | null | undefined): GdeltMode | undefined {
  return MODES.find((m) => m === value);
}

export function isValidTimespan(value: string): boolean {
  return TIMESPAN_PATTERN.test(value);
}

export interface GdeltSearchParams {
  query: string;
  mode?: GdeltMode;
  timespan?: string;
  format?: GdeltFormat;
  maxrecords?: number;
  callback?: string;
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

/** GDELT's throttle arrives as HTTP 200 plain text, not a 429. */
const THROTTLE_MARKERS = [
  'Please limit requests to one every 5 seconds',
  'rate limit',
];

export class GdeltRateLimitError extends Error {
  constructor(message = 'GDELT rate limited this client') {
    super(message);
    this.name = 'GdeltRateLimitError';
  }
}

export class GdeltApi {
  private static isThrottleText(text: string): boolean {
    const lower = text.slice(0, 400).toLowerCase();
    return THROTTLE_MARKERS.some((m) => lower.includes(m));
  }

  /**
   * Raw fetch across primary then backup host. Throws GdeltRateLimitError on
   * throttle text or HTTP 429. Returns parsed JSON for json format.
   */
  static async fetchRaw(params: URLSearchParams): Promise<unknown> {
    let lastError: Error = new Error('GDELT request never attempted');

    for (const host of GDELT_HOSTS) {
      const url = `${host}/api/v2/doc/doc?${params.toString()}`;
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': BROWSER_UA },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (response.status === 429) {
          throw new GdeltRateLimitError();
        }

        const contentType = response.headers.get('content-type') || '';
        const rawText =
          contentType.includes('application/json') ? null : await response.text();

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${host}`);
        }
        if (rawText !== null) {
          if (this.isThrottleText(rawText)) throw new GdeltRateLimitError();
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

  static buildParams({
    query,
    mode = 'artlist',
    timespan,
    format = 'json',
    maxrecords = 75,
    callback,
    sort = 'DateDesc',
  }: GdeltSearchParams): URLSearchParams {
    if (query.length < 3 || query.length > 1000) {
      throw new Error('Query must be between 3 and 1000 characters');
    }

    if (timespan && !isValidTimespan(timespan)) {
      throw new Error('Invalid timespan format');
    }

    if (callback && !/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(callback)) {
      throw new Error('Invalid callback function name');
    }

    if (maxrecords < 1 || maxrecords > 250) {
      throw new Error('maxrecords must be between 1 and 250');
    }

    const params = new URLSearchParams({
      query,
      mode,
      format,
      maxrecords: maxrecords.toString(),
      sort,
    });

    if (timespan) params.append('timespan', timespan);
    if (callback && format === 'jsonp') params.append('callback', callback);
    return params;
  }

  /** Artlist search returning typed articles. */
  static async searchArticles(params: GdeltSearchParams): Promise<GdeltResponse> {
    const data = (await this.fetchRaw(this.buildParams(params))) as Partial<GdeltResponse>;

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
  }
}
