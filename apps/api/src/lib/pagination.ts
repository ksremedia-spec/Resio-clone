import { base64UrlToBytes, bytesToBase64Url, utf8 } from './base64.js';

/** Opaque cursor helpers for keyset pagination. */
export function encodeCursor(parts: Record<string, string | number | null>): string {
  return bytesToBase64Url(utf8.encode(JSON.stringify(parts)));
}

export function decodeCursor<T extends Record<string, string | number | null>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(utf8.decode(base64UrlToBytes(cursor))) as T;
  } catch {
    return null;
  }
}

export function page<T>(rows: T[], limit: number, makeCursor: (row: T) => string): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    return { items, nextCursor: makeCursor(items[items.length - 1]!) };
  }
  return { items: rows, nextCursor: null };
}
