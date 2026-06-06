import { describe, expect, it } from 'vitest'

import { buildSideBySideDiffRows } from './git-diff'

describe('kanban git diff helpers', () => {
  it('keeps diff headers as metadata and does not treat file headers as code changes', () => {
    const rows = buildSideBySideDiffRows(['diff --git a/file.ts b/file.ts', '--- a/file.ts', '+++ b/file.ts'].join('\n'))

    expect(rows).toEqual([
      { kind: 'meta', meta: 'diff --git a/file.ts b/file.ts' },
      { kind: 'meta', meta: '--- a/file.ts' },
      { kind: 'meta', meta: '+++ b/file.ts' }
    ])
  })

  it('does not confuse code that starts with ++ or -- with file headers', () => {
    const rows = buildSideBySideDiffRows(['@@ -1 +1 @@', '---count', '+++count'].join('\n'))

    expect(rows).toEqual([
      { kind: 'meta', meta: '@@ -1 +1 @@' },
      { kind: 'changed', oldText: '--count', newText: '++count' }
    ])
  })

  it('splits unified hunks into old and new panes', () => {
    const rows = buildSideBySideDiffRows(
      [
        '@@ -1,4 +1,5 @@',
        ' const same = true',
        '-const oldName = "old"',
        '+const newName = "new"',
        '-removedOnly()',
        '+addedOnly()',
        ' trailingContext()'
      ].join('\n')
    )

    expect(rows).toEqual([
      { kind: 'meta', meta: '@@ -1,4 +1,5 @@' },
      { kind: 'context', oldText: 'const same = true', newText: 'const same = true' },
      { kind: 'changed', oldText: 'const oldName = "old"', newText: 'const newName = "new"' },
      { kind: 'changed', oldText: 'removedOnly()', newText: 'addedOnly()' },
      { kind: 'context', oldText: 'trailingContext()', newText: 'trailingContext()' }
    ])
  })

  it('keeps unpaired additions and removals on the correct side', () => {
    const rows = buildSideBySideDiffRows(['-oldOnly()', ' context()', '+newOnly()'].join('\n'))

    expect(rows).toEqual([
      { kind: 'removed', oldText: 'oldOnly()', newText: '' },
      { kind: 'context', oldText: 'context()', newText: 'context()' },
      { kind: 'added', oldText: '', newText: 'newOnly()' }
    ])
  })
})
