/**
 * The DOC artlist fields Meridian renders. GDELT returns more — add a field
 * here only when a surface actually reads it.
 */
export interface Article {
  url: string;
  title: string;
  sourcecountry?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  tone?: number;
}
