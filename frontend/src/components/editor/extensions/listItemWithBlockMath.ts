import { ListItem } from '@tiptap/extension-list';

/**
 * The stock ListItem content spec is `paragraph block*`, which requires a
 * paragraph as the first child. A list item whose markdown starts with a
 * $$-math block parses to a leading blockMath node and fails schema
 * validation. Allow blockMath wherever the leading paragraph may stand.
 */
export const ListItemWithBlockMath = ListItem.extend({
  content: '(paragraph | blockMath) block*',
});
