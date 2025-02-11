export interface Article {
  url: string;
  url_mobile?: string;
  title: string;
  sourcecountry?: string;
  language?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  tone?: number;
  locations?: Location[];
  themes?: string[];
  persons?: string[];
  organizations?: string[];
  images?: Image[];
}

export interface Image {
  url: string;
  tags?: string[];
  webCount?: number;
  faceTone?: number;
  numFaces?: number;
  landmarks?: string[];
  labels?: string[];
  safeSearch?: {
    adult: SafeSearchLikelihood;
    violence: SafeSearchLikelihood;
  };
}

export interface Location {
  lat: number;
  lon: number;
  name: string;
  type?: 'CITY' | 'COUNTRY' | 'LANDMARK';
  confidence?: number;
}

export type SafeSearchLikelihood = 
  | 'VERY_UNLIKELY' 
  | 'UNLIKELY' 
  | 'POSSIBLE' 
  | 'LIKELY' 
  | 'VERY_LIKELY'; 