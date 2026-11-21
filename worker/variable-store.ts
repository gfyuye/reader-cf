import type { D1Database } from "@cloudflare/workers-types";

export interface VariableStoreConfig {
  userNs: string;
  bookSourceUrl: string;
  scope: "global" | "book" | "chapter";
  bookUrl?: string;
  chapterIndex?: number;
}

export interface VariableStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<Record<string, string>>;
  clear(): Promise<void>;
}

function makeKey(config: VariableStoreConfig, varKey: string): string {
  const parts = [
    config.userNs,
    config.bookSourceUrl,
    config.scope,
    config.bookUrl || "",
    String(config.chapterIndex || ""),
    varKey,
  ];
  return parts.join("|");
}

export function createVariableStore(db: D1Database, config: VariableStoreConfig): VariableStore {
  return {
    async get(key: string): Promise<string | undefined> {
      const fullKey = makeKey(config, key);
      const result = await db
        .prepare(
          "SELECT var_value FROM book_source_variables WHERE user_ns = ? AND book_source_url = ? AND scope = ? AND book_url = ? AND chapter_index = ? AND var_key = ?"
        )
        .bind(config.userNs, config.bookSourceUrl, config.scope, config.bookUrl || null, config.chapterIndex || null, key)
        .first<{ var_value: string }>();
      return result?.var_value;
    },

    async set(key: string, value: string): Promise<void> {
      const now = Date.now();
      await db
        .prepare(
          `INSERT INTO book_source_variables (user_ns, book_source_url, scope, book_url, chapter_index, var_key, var_value, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_ns, book_source_url, scope, book_url, chapter_index, var_key)
           DO UPDATE SET var_value = excluded.var_value, updated_at = excluded.updated_at`
        )
        .bind(config.userNs, config.bookSourceUrl, config.scope, config.bookUrl || null, config.chapterIndex || null, key, value, now)
        .run();
    },

    async delete(key: string): Promise<void> {
      await db
        .prepare(
          "DELETE FROM book_source_variables WHERE user_ns = ? AND book_source_url = ? AND scope = ? AND book_url = ? AND chapter_index = ? AND var_key = ?"
        )
        .bind(config.userNs, config.bookSourceUrl, config.scope, config.bookUrl || null, config.chapterIndex || null, key)
        .run();
    },

    async getAll(): Promise<Record<string, string>> {
      const results = await db
        .prepare(
          "SELECT var_key, var_value FROM book_source_variables WHERE user_ns = ? AND book_source_url = ? AND scope = ? AND book_url = ? AND chapter_index = ?"
        )
        .bind(config.userNs, config.bookSourceUrl, config.scope, config.bookUrl || null, config.chapterIndex || null)
        .all<{ var_key: string; var_value: string }>();

      const obj: Record<string, string> = {};
      for (const row of results.results || []) {
        obj[row.var_key] = row.var_value;
      }
      return obj;
    },

    async clear(): Promise<void> {
      await db
        .prepare(
          "DELETE FROM book_source_variables WHERE user_ns = ? AND book_source_url = ? AND scope = ? AND book_url = ? AND chapter_index = ?"
        )
        .bind(config.userNs, config.bookSourceUrl, config.scope, config.bookUrl || null, config.chapterIndex || null)
        .run();
    },
  };
}

export function createLegadoVariables(
  db: D1Database | null,
  context: { userNs?: string; bookSourceUrl?: string; bookUrl?: string; chapterIndex?: number }
): { javaPut: (k: string, v: any) => Promise<any>; javaGet: (k: string) => Promise<string>; bookGet: (k: string) => Promise<string>; bookSet: (k: string, v: any) => Promise<void> } {
  const userNs = context.userNs || "default";
  const bookSourceUrl = context.bookSourceUrl || "";
  const bookUrl = context.bookUrl || "";
  const chapterIndex = context.chapterIndex;

  const globalStore = db ? createVariableStore(db, { userNs, bookSourceUrl, scope: "global" }) : null;
  const bookStore = db && bookUrl ? createVariableStore(db, { userNs, bookSourceUrl, scope: "book", bookUrl }) : null;
  const chapterStore = db && bookUrl && chapterIndex !== undefined
    ? createVariableStore(db, { userNs, bookSourceUrl, scope: "chapter", bookUrl, chapterIndex })
    : null;

  const memoryCache = new Map<string, string>();

  return {
    async javaPut(k: string, v: any) {
      const value = JSON.stringify(v);
      memoryCache.set(`global:${k}`, value);
      if (globalStore) {
        await globalStore.set(k, value);
      }
      return v;
    },

    async javaGet(k: string): Promise<any> {
      const cached = memoryCache.get(`global:${k}`);
      if (cached !== undefined) {
        try { return JSON.parse(cached); } catch { return cached; }
      }

      if (globalStore) {
        const value = await globalStore.get(k);
        if (value !== undefined) {
          memoryCache.set(`global:${k}`, value);
          try { return JSON.parse(value); } catch { return value; }
        }
      }
      return "";
    },

    async bookGet(k: string): Promise<any> {
      if (!bookUrl) return "";
      const cached = memoryCache.get(`book:${bookUrl}:${k}`);
      if (cached !== undefined) {
        try { return JSON.parse(cached); } catch { return cached; }
      }

      // Try chapter scope first, then book scope
      if (chapterStore && chapterIndex !== undefined) {
        const value = await chapterStore.get(k);
        if (value !== undefined) {
          memoryCache.set(`book:${bookUrl}:${k}`, value);
          try { return JSON.parse(value); } catch { return value; }
        }
      }
      if (bookStore) {
        const value = await bookStore.get(k);
        if (value !== undefined) {
          memoryCache.set(`book:${bookUrl}:${k}`, value);
          try { return JSON.parse(value); } catch { return value; }
        }
      }
      return "";
    },

    async bookSet(k: string, v: any): Promise<void> {
      if (!bookUrl) return;
      const value = JSON.stringify(v);
      memoryCache.set(`book:${bookUrl}:${k}`, value);
      // Prefer chapter scope if available, otherwise book scope
      if (chapterStore && chapterIndex !== undefined) {
        await chapterStore.set(k, value);
      } else if (bookStore) {
        await bookStore.set(k, value);
      }
    },
  };
}