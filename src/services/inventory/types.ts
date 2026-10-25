import type { Condition, DeliveryOptionId } from '@/domain/types';

/**
 * Merchant inventory ingestion contracts (server-side; documented here so the customer
 * app and the future merchant dashboard share one vocabulary). Not implemented in Milestone 1.
 *
 * Three ingestion methods feed the same pipeline:
 *   1. API connectors to a merchant's ERP / POS / inventory system
 *   2. Excel / CSV upload with column mapping, validation and preview
 *   3. Manual entry in the merchant dashboard
 */

export type IngestionMethod = 'api' | 'file' | 'manual';

/** One row as understood by Qitah after mapping, regardless of source. */
export type InventoryRecord = {
  merchantSku: string;
  partNumber?: string;
  brand?: string;
  /** Resolved canonical product, or undefined when it needs catalog matching/review. */
  productId?: string;
  price: number;
  stock: number;
  condition: Condition;
  warrantyMonths?: number;
  dispatchDays?: [number, number];
  deliveryOptions?: DeliveryOptionId[];
  sourceUpdatedAt: number;
};

export type RecordIssue = {
  row: number;
  field: keyof InventoryRecord | string;
  severity: 'error' | 'warning';
  code: 'missing_required' | 'invalid_number' | 'unknown_product' | 'duplicate_sku' | 'price_outlier' | 'stale_source';
};

export type ColumnMapping = Record<string, keyof InventoryRecord | 'ignore'>;

/** Every connector — ERP API, file import, manual — implements this. No ERP is hard-coded. */
export interface InventorySource {
  readonly method: IngestionMethod;
  readonly merchantId: string;
  /** Pulls (or receives) a batch of records since the given cursor. */
  fetch(cursor?: string): Promise<{ records: InventoryRecord[]; nextCursor?: string }>;
}

export interface FileImportSession {
  detectColumns(): Promise<string[]>;
  applyMapping(mapping: ColumnMapping): Promise<{ preview: InventoryRecord[]; issues: RecordIssue[] }>;
  commit(): Promise<SyncResult>;
}

export type SyncConflict = {
  merchantSku: string;
  kind: 'stale_update' | 'concurrent_edit' | 'negative_stock' | 'reserved_exceeds_stock';
  resolution: 'kept_latest' | 'kept_reserved' | 'needs_review';
};

export type SyncResult = {
  merchantId: string;
  method: IngestionMethod;
  startedAt: number;
  finishedAt: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  issues: RecordIssue[];
  conflicts: SyncConflict[];
};

/**
 * Overselling protection: stock shown to customers = merchant stock − active reservations,
 * and offers whose source data is older than `staleAfterMinutes` are hidden or flagged.
 */
export interface StockReservationService {
  reserve(offerId: string, qty: number, ttlSeconds: number): Promise<{ reservationId: string } | { error: 'insufficient_stock' }>;
  release(reservationId: string): Promise<void>;
  commit(reservationId: string): Promise<void>;
}

export type FreshnessPolicy = { staleAfterMinutes: number; hideWhenStale: boolean };
