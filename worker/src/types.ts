export interface Env {
  ENV: 'development' | 'production';
  ALLOWED_TRACKING_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ENCRYPTION_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  DEV_KIWIFY_SECRET?: string;
  DEV_HOTMART_SECRET?: string;
  DEV_PAYT_SECRET?: string;
  GOOGLE_ADS_CLIENT_ID: string;
  GOOGLE_ADS_CLIENT_SECRET: string;
  GOOGLE_ADS_DEVELOPER_TOKEN: string;
  GOOGLE_ADS_OAUTH_REDIRECT_URI: string;
  WORKER_INTERNAL_TOKEN: string;
  SUPABASE_JWT_SECRET: string;
}

export type MatchMethod = 'click_id' | 'gclid_in_payload' | 'unmatched';

export type ConversionType =
  | 'pix_generated'
  | 'billet_generated'
  | 'paid'
  | 'refund'
  | 'chargeback'
  | 'abandoned'
  | 'expired';

export interface ConversionDraft {
  external_order_id: string;
  conversion_type: ConversionType;
  amount: number;
  currency: string;
  customer_email?: string;
  customer_phone?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  click_id_from_payload?: string;
  gclid_from_payload?: string;
  wbraid_from_payload?: string;
  gbraid_from_payload?: string;
  occurred_at: string;
  raw: unknown;
  offer_external_id?: string;
  // Flag de produção: true = evento de teste (Payt envia test:bool no payload).
  // Default semântico false quando undefined — buildConversionRow propaga ?? false.
  // Kiwify/Hotmart hardcodam false explicitamente até expor flag equivalente.
  is_test?: boolean;
}

export interface ClickRecord {
  click_id: string;
  visitor_id: string;
  workspace_id: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  gclsrc?: string;
  gad_source?: string;
  gad_campaignid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_id_parsed?: string;
  campaign_name_parsed?: string;
  adset_id_parsed?: string;
  adset_name_parsed?: string;
  ad_id_parsed?: string;
  ad_name_parsed?: string;
  ip?: string;
  user_agent?: string;
  referrer?: string;
  landing_url: string;
  country?: string;
  region?: string;
  city?: string;
  device_type?: string;
  os?: string;
  browser?: string;
}
