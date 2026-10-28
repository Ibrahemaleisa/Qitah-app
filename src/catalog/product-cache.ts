import type { Offer, Product, Seller } from '@/domain/types';

/**
 * Bounded, on-demand product cache for REMOTE mode (replaces the full catalog snapshot).
 *
 * - LRU over products (default ≤ 500). Pinned products (cart lines, favorites) are never evicted.
 * - Each product is persisted under ITS OWN storage key (`<prefix>p:<id>`), plus a small index (LRU order +
 *   the `/v1/catalog/changes` cursor) and the referenced sellers: no single large blob, so Android's
 *   per-row AsyncStorage limit (~2 MB) and a giant JSON.parse at startup are both avoided.
 * - Writes are batched (dirty set, debounced flush). Pure logic: storage and clock are injected, so it is
 *   unit-tested without React Native.
 */

/** The subset of AsyncStorage the cache needs (AsyncStorage v2 satisfies it). */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
};

export type CacheEntry = {
  product: Product;
  offers: Offer[];
  /** True when the entry came from a search page (no seller payloads): detail screens refetch in the background. */
  partial: boolean;
  /** Epoch ms of the network response this entry came from. */
  fetchedAt: number;
};

export type ProductPayload = { product: Product; offers: Offer[]; partial?: boolean };

export type ChangesPayload = { products: ProductPayload[]; sellers: Seller[]; removed: string[]; serverTime: string };

type Options = {
  capacity?: number;
  storage?: KeyValueStore;
  prefix?: string;
  now?: () => number;
  /** Debounce for persistence; 0 = only on explicit `flush()`. */
  flushDelayMs?: number;
  /** Product ids that must not be evicted (cart, favorites). */
  pinned?: () => Iterable<string>;
};

const VERSION = 1;
const CHUNK = 100;

export class ProductCache {
  readonly capacity: number;
  private storage?: KeyValueStore;
  private readonly prefix: string;
  private readonly now: () => number;
  private readonly flushDelayMs: number;
  private pinned: () => Iterable<string>;
  /** Insertion order = LRU order (oldest first); `touch` re-inserts. */
  private entries = new Map<string, CacheEntry>();
  private sellerMap = new Map<string, Seller>();
  /** Offers known without their product (e.g. a cart line refreshed before its product loaded). */
  private loose = new Map<string, Offer>();
  /** `/v1/catalog/changes` cursor: server time of the last applied delta (ISO), or null. */
  since: string | null = null;
  private dirty = new Set<string>();
  private removedKeys = new Set<string>();
  private indexDirty = false;
  private sellersDirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: { products: Product[]; offers: Offer[]; sellers: Seller[] } | null = null;

  constructor(opts: Options = {}) {
    this.capacity = opts.capacity ?? 500;
    this.storage = opts.storage;
    this.prefix = opts.prefix ?? 'qitah-pc:';
    this.now = opts.now ?? Date.now;
    this.flushDelayMs = opts.flushDelayMs ?? 300;
    this.pinned = opts.pinned ?? (() => []);
  }

  setPinned(fn: () => Iterable<string>) {
    this.pinned = fn;
  }

  /** Attaches persistent storage (the app does this once at boot; tests keep the cache in memory). */
  setStorage(storage: KeyValueStore) {
    this.storage = storage;
  }

  get size() {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  has(id: string) {
    return this.entries.has(id);
  }

  get(id: string): CacheEntry | undefined {
    return this.entries.get(id);
  }

  /** Marks a product as recently used (moves it to the young end of the LRU). Not persisted on its own. */
  touch(id: string) {
    const e = this.entries.get(id);
    if (!e || this.lastKey() === id) return;
    this.entries.delete(id);
    this.entries.set(id, e);
    this.indexDirty = true;
  }

  getSeller(id: string) {
    return this.sellerMap.get(id);
  }

  /** Flat arrays for the in-memory catalog store (memoised until the next change). */
  view() {
    if (!this.snapshot) {
      const entries = [...this.entries.values()];
      const offers = entries.flatMap((e) => e.offers);
      const known = new Set(offers.map((o) => o.id));
      for (const o of this.loose.values()) if (!known.has(o.id)) offers.push(o);
      this.snapshot = { products: entries.map((e) => e.product), offers, sellers: [...this.sellerMap.values()] };
    }
    return this.snapshot;
  }

  /**
   * Adds or replaces products (+ their sellers). A `partial` payload (search result, no sellers) never
   * downgrades a complete entry. Offers that disappear from a refreshed product but are listed in
   * `keepOfferIds` (cart lines) are kept, flagged unavailable, so the cart can explain them.
   * Returns the ids evicted to stay within capacity.
   */
  put(payloads: ProductPayload[], sellers: Seller[] = [], opts: { keepOfferIds?: Iterable<string>; fetchedAt?: number } = {}): string[] {
    const keep = new Set(opts.keepOfferIds ?? []);
    const fetchedAt = opts.fetchedAt ?? this.now();
    for (const p of payloads) {
      const id = p.product.id;
      const prev = this.entries.get(id);
      const partial = !!p.partial;
      if (prev && partial && !prev.partial) {
        // Keep the complete entry; only take fresher price/stock for the offers we know.
        this.mergeOfferList(prev, p.offers);
        this.touch(id);
        this.dirty.add(id);
        continue;
      }
      const returned = new Set(p.offers.map((o) => o.id));
      const vanished = (prev?.offers ?? []).filter((o) => !returned.has(o.id) && keep.has(o.id)).map((o) => ({ ...o, stock: 0, unavailable: true as const }));
      this.entries.delete(id);
      this.entries.set(id, { product: p.product, offers: [...p.offers, ...vanished], partial, fetchedAt });
      for (const o of p.offers) this.loose.delete(o.id);
      this.dirty.add(id);
    }
    this.upsertSellers(sellers);
    this.indexDirty = true;
    const evicted = this.evict();
    this.changed();
    return evicted;
  }

  upsertSellers(sellers: Seller[]) {
    for (const s of sellers) this.sellerMap.set(s.id, s);
    if (sellers.length) {
      this.sellersDirty = true;
      this.changed();
    }
  }

  /** Live price/stock for specific offers (`GET /v1/catalog/offers`). Unknown offers are kept as loose. */
  mergeOffers(live: Offer[]) {
    if (!live.length) return;
    const byProduct = new Map<string, Offer[]>();
    for (const o of live) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), o]);
    for (const [productId, list] of byProduct) {
      const e = this.entries.get(productId);
      if (e) {
        const missing = this.mergeOfferList(e, list);
        e.offers.push(...missing);
        this.dirty.add(productId);
      } else for (const o of list) this.loose.set(o.id, o);
    }
    this.changed();
  }

  /** Offers the server no longer knows at all: kept, flagged unavailable. */
  markOffersMissing(ids: string[]) {
    if (!ids.length) return;
    const missing = new Set(ids);
    for (const [id, e] of this.entries) {
      if (!e.offers.some((o) => missing.has(o.id))) continue;
      e.offers = e.offers.map((o) => (missing.has(o.id) ? { ...o, stock: 0, unavailable: true } : o));
      this.dirty.add(id);
    }
    for (const id of missing) {
      const o = this.loose.get(id);
      if (o) this.loose.set(id, { ...o, stock: 0, unavailable: true });
    }
    this.changed();
  }

  /**
   * Applies a `/v1/catalog/changes` response: changed products are replaced (LRU position kept), removed
   * ones keep their data but every offer becomes unavailable, and the cursor advances to `serverTime`.
   */
  applyChanges(c: ChangesPayload, opts: { keepOfferIds?: Iterable<string> } = {}) {
    const keep = new Set(opts.keepOfferIds ?? []);
    for (const p of c.products) {
      const prev = this.entries.get(p.product.id);
      if (!prev) continue; // only products we hold
      const returned = new Set(p.offers.map((o) => o.id));
      const vanished = prev.offers.filter((o) => !returned.has(o.id) && keep.has(o.id)).map((o) => ({ ...o, stock: 0, unavailable: true as const }));
      prev.product = p.product;
      prev.offers = [...p.offers, ...vanished];
      prev.partial = false;
      prev.fetchedAt = this.now();
      this.dirty.add(p.product.id);
    }
    for (const id of c.removed) {
      const e = this.entries.get(id);
      if (!e) continue;
      e.offers = e.offers.map((o) => ({ ...o, stock: 0, unavailable: true }));
      this.dirty.add(id);
    }
    this.upsertSellers(c.sellers);
    this.setCursor(c.serverTime);
    this.changed();
  }

  setCursor(since: string | null) {
    this.since = since;
    this.indexDirty = true;
    this.schedule();
  }

  remove(ids: string[]) {
    for (const id of ids) {
      if (!this.entries.delete(id)) continue;
      this.dirty.delete(id);
      this.removedKeys.add(this.key(id));
    }
    this.indexDirty = true;
    this.changed();
  }

  clear() {
    for (const id of this.entries.keys()) this.removedKeys.add(this.key(id));
    this.entries.clear();
    this.loose.clear();
    this.dirty.clear();
    this.since = null;
    this.indexDirty = true;
    this.sellersDirty = true;
    this.changed();
  }

  /** Drops the least recently used unpinned products beyond capacity. */
  evict(): string[] {
    if (this.entries.size <= this.capacity) return [];
    const pinned = new Set(this.pinned());
    const evicted: string[] = [];
    for (const id of this.entries.keys()) {
      if (this.entries.size - evicted.length <= this.capacity) break;
      if (pinned.has(id)) continue;
      evicted.push(id);
    }
    if (evicted.length) this.remove(evicted);
    return evicted;
  }

  // ── persistence

  /** Restores the cache from storage (index first, then the product rows in chunks). */
  async load(): Promise<number> {
    if (!this.storage) return 0;
    const rawIndex = await this.storage.getItem(this.indexKey());
    if (!rawIndex) return 0;
    let index: { v: number; ids: string[]; since: string | null };
    try {
      index = JSON.parse(rawIndex);
    } catch {
      return 0;
    }
    if (index?.v !== VERSION || !Array.isArray(index.ids)) return 0;
    const restored = new Map<string, CacheEntry>();
    for (let i = 0; i < index.ids.length; i += CHUNK) {
      const rows = await this.storage.multiGet(index.ids.slice(i, i + CHUNK).map((id) => this.key(id)));
      for (const [, raw] of rows) {
        if (!raw) continue;
        try {
          const e = JSON.parse(raw) as CacheEntry & { v: number };
          if (e?.v === VERSION && e.product?.id) restored.set(e.product.id, { product: e.product, offers: e.offers ?? [], partial: !!e.partial, fetchedAt: e.fetchedAt ?? 0 });
        } catch {
          // A corrupt row only loses that product.
        }
      }
    }
    try {
      const sellers = JSON.parse((await this.storage.getItem(this.sellersKey())) ?? '[]') as Seller[];
      for (const s of sellers) if (s?.id && !this.sellerMap.has(s.id)) this.sellerMap.set(s.id, s);
    } catch {
      // ignore
    }
    // Entries fetched in this session win over the stored copies.
    const live = this.entries;
    this.entries = new Map([...restored].filter(([id]) => !live.has(id)));
    for (const [id, e] of live) this.entries.set(id, e);
    this.since = this.since ?? index.since ?? null;
    this.evict();
    this.changed(false);
    return restored.size;
  }

  /** Writes dirty products, removals, the index and sellers. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.storage) return;
    const pairs: [string, string][] = [];
    for (const id of this.dirty) {
      const e = this.entries.get(id);
      if (e) pairs.push([this.key(id), JSON.stringify({ v: VERSION, ...e })]);
    }
    this.dirty.clear();
    if (this.indexDirty) pairs.push([this.indexKey(), JSON.stringify({ v: VERSION, ids: this.ids(), since: this.since })]);
    this.indexDirty = false;
    if (this.sellersDirty) {
      const referenced = new Set([...this.entries.values()].flatMap((e) => e.offers.map((o) => o.sellerId)));
      pairs.push([this.sellersKey(), JSON.stringify([...this.sellerMap.values()].filter((s) => referenced.has(s.id)))]);
      this.sellersDirty = false;
    }
    const removed = [...this.removedKeys];
    this.removedKeys.clear();
    for (let i = 0; i < pairs.length; i += CHUNK) await this.storage.multiSet(pairs.slice(i, i + CHUNK));
    if (removed.length) await this.storage.multiRemove(removed);
  }

  // ── internals

  private mergeOfferList(e: CacheEntry, live: Offer[]): Offer[] {
    const byId = new Map(live.map((o) => [o.id, o]));
    e.offers = e.offers.map((o) => byId.get(o.id) ?? o);
    const known = new Set(e.offers.map((o) => o.id));
    return live.filter((o) => !known.has(o.id));
  }

  private lastKey() {
    let last: string | undefined;
    for (const k of this.entries.keys()) last = k;
    return last;
  }

  private changed(persist = true) {
    this.snapshot = null;
    if (persist) this.schedule();
  }

  private schedule() {
    if (!this.storage || this.flushDelayMs <= 0 || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.flushDelayMs);
  }

  private key(id: string) {
    return `${this.prefix}p:${id}`;
  }
  private indexKey() {
    return `${this.prefix}index`;
  }
  private sellersKey() {
    return `${this.prefix}sellers`;
  }
}
