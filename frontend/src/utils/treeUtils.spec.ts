// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { NodeRecord, TreeNode } from '../types/node';

// The module imports vue-i18n via ../i18n; mock it so the test is self-contained
// and the sibling-name-conflict message is deterministic.
vi.mock('../i18n', () => ({
  i18n: {
    global: {
      t: (key: string) => `msg:${key}`,
    },
  },
  default: {
    global: {
      t: (key: string) => `msg:${key}`,
    },
  },
}));

import {
  generateId,
  cloneNode,
  bySortOrder,
  buildParentIndex,
  collectDescendantIds,
  assertSiblingNameUnique,
  normalizeSiblingOrder,
  nextSortOrder,
  buildPath,
  buildTree,
  findTreeNode,
  collectTreeDescendantIds,
} from './treeUtils';

function node(partial: Partial<NodeRecord> & { id: string; name: string }): NodeRecord {
  return {
    id: partial.id,
    name: partial.name,
    content: '',
    parentId: null,
    sortOrder: 0,
    ...partial,
  };
}

const nodes: NodeRecord[] = [
  node({ id: 'root', name: 'Root', parentId: null, sortOrder: 0 }),
  node({ id: 'a', name: 'A', parentId: 'root', sortOrder: 0 }),
  node({ id: 'b', name: 'B', parentId: 'root', sortOrder: 1 }),
  node({ id: 'a1', name: 'A1', parentId: 'a', sortOrder: 0 }),
  node({ id: 'a2', name: 'A2', parentId: 'a', sortOrder: 1 }),
  node({ id: 'a1x', name: 'A1X', parentId: 'a1', sortOrder: 0 }),
];

describe('treeUtils', () => {
  describe('generateId', () => {
    it('returns a non-empty string', () => {
      expect(generateId()).toBeTruthy();
      expect(typeof generateId()).toBe('string');
    });

    it('returns unique ids across repeated calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateId()));
      expect(ids.size).toBe(20);
    });

    it('falls back to a timestamp-based id when crypto.randomUUID is unavailable', () => {
      const originalUUID = crypto.randomUUID;
      (crypto as unknown as { randomUUID: unknown }).randomUUID = undefined;
      try {
        const id = generateId();
        expect(id).toMatch(/^node-\d+-[0-9a-f]+$/);
      } finally {
        (crypto as unknown as { randomUUID: typeof originalUUID }).randomUUID =
          originalUUID;
      }
    });
  });

  describe('cloneNode', () => {
    it('creates an equal but distinct object', () => {
      const original = node({ id: 'x', name: 'X', parentId: 'root', sortOrder: 3 });
      const copy = cloneNode(original);
      expect(copy).toEqual(original);
      expect(copy).not.toBe(original);
    });

    it('preserves every NodeRecord field', () => {
      const original = node({
        id: 'k',
        name: 'Knowledge',
        content: 'some content',
        parentId: 'parent',
        sortOrder: 7,
      });
      expect(cloneNode(original)).toEqual({
        id: 'k',
        name: 'Knowledge',
        content: 'some content',
        parentId: 'parent',
        sortOrder: 7,
      });
    });
  });

  describe('bySortOrder', () => {
    it('sorts ascending by sortOrder, then by name for ties', () => {
      const list = [
        node({ id: 'b', name: 'Beta', sortOrder: 1 }),
        node({ id: 'a', name: 'Alpha', sortOrder: 1 }),
        node({ id: 'c', name: 'Gamma', sortOrder: 0 }),
      ];
      const sorted = [...list].sort(bySortOrder);
      expect(sorted.map((n) => n.id)).toEqual(['c', 'a', 'b']);
    });

    it('returns 0 for identical nodes', () => {
      const a = node({ id: 'x', name: 'X', sortOrder: 2 });
      const b = node({ id: 'x', name: 'X', sortOrder: 2 });
      expect(bySortOrder(a, b)).toBe(0);
    });
  });

  describe('buildParentIndex', () => {
    it('groups children by parentId, skipping root nodes', () => {
      const index = buildParentIndex(nodes);
      expect([...index.keys()]).toEqual(['root', 'a', 'a1']);
      expect(index.get('root')!.map((n) => n.id)).toEqual(['a', 'b']);
      expect(index.get('a')!.map((n) => n.id)).toEqual(['a1', 'a2']);
      expect(index.get('a1')!.map((n) => n.id)).toEqual(['a1x']);
    });

    it('returns an empty map for an empty node list', () => {
      expect(buildParentIndex([]).size).toBe(0);
    });
  });

  describe('collectDescendantIds', () => {
    it('collects all descendant ids recursively, excluding the node itself', () => {
      const result = new Set<string>();
      collectDescendantIds(nodes, 'a', result);
      expect(result).toEqual(new Set(['a1', 'a2', 'a1x']));
    });

    it('leaves the result untouched when the node has no children', () => {
      const result = new Set(['existing']);
      collectDescendantIds(nodes, 'a2', result);
      expect(result).toEqual(new Set(['existing']));
    });
  });

  describe('assertSiblingNameUnique', () => {
    it('does not throw when the sibling name is unique', () => {
      expect(() => assertSiblingNameUnique(nodes, 'root', 'C')).not.toThrow();
    });

    it('throws with the i18n conflict message on a duplicate sibling name', () => {
      expect(() => assertSiblingNameUnique(nodes, 'root', 'A')).toThrow(
        'msg:errors.siblingNameConflict',
      );
    });

    it('ignores the node identified by ignoreId', () => {
      expect(() => assertSiblingNameUnique(nodes, 'root', 'A', 'a')).not.toThrow();
    });

    it('only compares within the same parent', () => {
      expect(() => assertSiblingNameUnique(nodes, 'a', 'B')).not.toThrow();
    });
  });

  describe('normalizeSiblingOrder', () => {
    it('renumbers sibling sortOrder to 0..n-1 in current relative order', () => {
      const list = [
        node({ id: 'x', name: 'X', parentId: 'root', sortOrder: 5 }),
        node({ id: 'y', name: 'Y', parentId: 'root', sortOrder: 2 }),
        node({ id: 'z', name: 'Z', parentId: 'root', sortOrder: 9 }),
      ];
      normalizeSiblingOrder(list, 'root');
      expect(list.find((n) => n.id === 'y')!.sortOrder).toBe(0);
      expect(list.find((n) => n.id === 'x')!.sortOrder).toBe(1);
      expect(list.find((n) => n.id === 'z')!.sortOrder).toBe(2);
    });

    it('leaves nodes under other parents untouched', () => {
      const list = [
        node({ id: 'a', name: 'A', parentId: 'root', sortOrder: 1 }),
        node({ id: 'b', name: 'B', parentId: 'root', sortOrder: 0 }),
        node({ id: 'c', name: 'C', parentId: 'other', sortOrder: 42 }),
      ];
      normalizeSiblingOrder(list, 'root');
      expect(list.find((n) => n.id === 'c')!.sortOrder).toBe(42);
    });
  });

  describe('nextSortOrder', () => {
    it('returns 0 when there are no siblings', () => {
      expect(nextSortOrder(nodes, 'does-not-exist')).toBe(0);
    });

    it('returns max sortOrder + 1 among siblings', () => {
      expect(nextSortOrder(nodes, 'root')).toBe(2); // a=0, b=1
    });

    it('excludes the node matching ignoreId', () => {
      const list = [
        node({ id: 'a', name: 'A', parentId: 'root', sortOrder: 0 }),
        node({ id: 'b', name: 'B', parentId: 'root', sortOrder: 5 }),
      ];
      expect(nextSortOrder(list, 'root', 'b')).toBe(1);
    });

    it('returns 0 when ignoreId is the only sibling', () => {
      const list = [node({ id: 'a', name: 'A', parentId: 'root', sortOrder: 3 })];
      expect(nextSortOrder(list, 'root', 'a')).toBe(0);
    });
  });

  describe('buildPath', () => {
    it('builds the ancestor chain from root down to the direct parent', () => {
      const path = buildPath(nodes, 'a1x');
      expect(path.map((n) => n.id)).toEqual(['root', 'a', 'a1']);
    });

    it('returns an empty path for a root node', () => {
      expect(buildPath(nodes, 'root')).toEqual([]);
    });

    it('returns an empty path for an unknown id', () => {
      expect(buildPath(nodes, 'nope')).toEqual([]);
    });

    it('returns clones, not references to the input records', () => {
      const path = buildPath(nodes, 'a1x');
      const root = nodes.find((n) => n.id === 'root')!;
      expect(path[0]).toEqual(root);
      expect(path[0]).not.toBe(root);
    });

    it('stops when an ancestor is missing from the list', () => {
      const list = [node({ id: 'orphan', name: 'Orphan', parentId: 'ghost' })];
      expect(buildPath(list, 'orphan')).toEqual([]);
    });
  });

  describe('buildTree', () => {
    it('builds the full nested tree from a flat list', () => {
      const tree = buildTree(nodes, null);
      expect(tree).toEqual([
        {
          id: 'root',
          name: 'Root',
          parentId: null,
          children: [
            {
              id: 'a',
              name: 'A',
              parentId: 'root',
              children: [
                {
                  id: 'a1',
                  name: 'A1',
                  parentId: 'a',
                  children: [{ id: 'a1x', name: 'A1X', parentId: 'a1', children: [] }],
                },
                { id: 'a2', name: 'A2', parentId: 'a', children: [] },
              ],
            },
            { id: 'b', name: 'B', parentId: 'root', children: [] },
          ],
        },
      ]);
    });

    it('sorts children by sortOrder then name', () => {
      const list = [
        node({ id: 'r', name: 'R', parentId: null, sortOrder: 0 }),
        node({ id: 'z', name: 'Zeta', parentId: 'r', sortOrder: 1 }),
        node({ id: 'a', name: 'Alpha', parentId: 'r', sortOrder: 1 }),
        node({ id: 'm', name: 'Middle', parentId: 'r', sortOrder: 0 }),
      ];
      const tree = buildTree(list, null);
      expect(tree[0].children.map((c) => c.id)).toEqual(['m', 'a', 'z']);
    });

    it('builds a subtree rooted at a specific parent', () => {
      const tree = buildTree(nodes, 'a');
      expect(tree.map((n) => n.id)).toEqual(['a1', 'a2']);
      expect(tree[0].children.map((n) => n.id)).toEqual(['a1x']);
    });
  });

  describe('findTreeNode', () => {
    it('finds a node at any depth', () => {
      const tree = buildTree(nodes, null);
      expect(findTreeNode(tree, 'a1x')?.name).toBe('A1X');
    });

    it('finds a root-level node', () => {
      const tree = buildTree(nodes, null);
      expect(findTreeNode(tree, 'root')?.id).toBe('root');
    });

    it('returns null when the id is absent', () => {
      const tree = buildTree(nodes, null);
      expect(findTreeNode(tree, 'missing')).toBeNull();
    });
  });

  describe('collectTreeDescendantIds', () => {
    it('collects every descendant id, excluding the node itself', () => {
      const tree = buildTree(nodes, null);
      const result = new Set<string>();
      collectTreeDescendantIds(tree[0], result);
      expect(result).toEqual(new Set(['a', 'b', 'a1', 'a2', 'a1x']));
    });

    it('is a no-op for null or a leaf node', () => {
      const result = new Set<string>();
      collectTreeDescendantIds(null, result);
      const leaf: TreeNode = { id: 'leaf', name: 'Leaf', parentId: 'x', children: [] };
      collectTreeDescendantIds(leaf, result);
      expect(result.size).toBe(0);
    });
  });
});
