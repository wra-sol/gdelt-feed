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
}

const GDELT_API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

export class GdeltApi {
  private static validateTimespan(timespan: string): boolean {
    return /^(\d+[mhdw]|3m)$/.test(timespan);
  }

  private static validateCallback(callback: string): boolean {
    return /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(callback);
  }

  static async searchArticles({
    query,
    mode = 'artlist',
    timespan,
    format = 'json',
    maxrecords = 75,
    callback,
    sort = 'DateDesc'
  }: GdeltSearchParams): Promise<GdeltResponse> {
    // Validate parameters
    if (query.length < 3 || query.length > 1000) {
      throw new Error('Query must be between 3 and 1000 characters');
    }

    if (timespan && !this.validateTimespan(timespan)) {
      throw new Error('Invalid timespan format');
    }

    if (callback && !this.validateCallback(callback)) {
      throw new Error('Invalid callback function name');
    }

    if (maxrecords < 1 || maxrecords > 250) {
      throw new Error('maxrecords must be between 1 and 250');
    }

    // Build query parameters
    const params = new URLSearchParams({
      query,
      mode,
      format,
      maxrecords: maxrecords.toString(),
      sort
    });

    if (timespan) params.append('timespan', timespan);
    if (callback && format === 'jsonp') params.append('callback', callback);

    try {
      const response = await fetch(`${GDELT_API_URL}?${params.toString()}`);
      
      if (!response.ok) {
        if (response.status === 429) {
          const resetTime = response.headers.get('X-RateLimit-Reset');
          throw new Error(`Rate limit exceeded. Reset at ${new Date(Number(resetTime) * 1000).toLocaleString()}`);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // NEW: Check if response is JSON
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const rawText = await response.text();
        throw new Error(`GDELT API error: Response not JSON. Received: ${rawText.slice(0, 100)}`);
      }

      // Then parse JSON
      const data = await response.json();
      
      if (data.status === 'ERROR') {
        throw new Error(data.error || 'Unknown API error');
      }

      return data as GdeltResponse;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`GDELT API error: ${error.message}`);
      }
      throw new Error('Unknown error occurred while fetching data');
    }
  }
} 