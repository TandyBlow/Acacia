import type { NodeContext } from '../types/node';

interface CacheEntry {
  context: NodeContext;
  timestamp: number;
}

const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string | null, CacheEntry>();

export function getCached(nodeId: string | null): NodeContext | null {
  const entry = cache.get(nodeId);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(nodeId);
    return null;
  }
  return entry.context;
}

export function setCache(nodeId: string | null, context: NodeContext): void {
  cache.set(nodeId, { context, timestamp: Date.now() });
}

export function invalidate(nodeId: string | null): void {
  cache.delete(nodeId);
}

export function invalidateAll(): void {
  cache.clear();
}
