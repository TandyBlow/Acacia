const INTERNAL_NODE_PROTOCOL = 'seewhat://node/';

export function buildInternalNodeHref(nodeId: string): string {
  return `${INTERNAL_NODE_PROTOCOL}${encodeURIComponent(nodeId)}`;
}

export function parseInternalNodeHref(href: string): string | null {
  if (!href.startsWith(INTERNAL_NODE_PROTOCOL)) {
    return null;
  }

  const rawNodeId = href.slice(INTERNAL_NODE_PROTOCOL.length);
  if (!rawNodeId) {
    return null;
  }

  try {
    return decodeURIComponent(rawNodeId);
  } catch {
    return null;
  }
}

export function isInternalNodeHref(href: string): boolean {
  return parseInternalNodeHref(href) !== null;
}
