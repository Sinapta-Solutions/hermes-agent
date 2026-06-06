export type SideBySideDiffRowKind = 'added' | 'changed' | 'context' | 'meta' | 'removed'

export interface SideBySideDiffRow {
  kind: SideBySideDiffRowKind
  meta?: string
  newText?: string
  oldText?: string
}

function normalizeDiffText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '')
}

function isUnifiedFileHeader(line: string, marker: '+++' | '---') {
  return line.startsWith(`${marker} a/`) || line.startsWith(`${marker} b/`) || line === `${marker} /dev/null`
}

function isAddedLine(line: string) {
  return line.startsWith('+') && !isUnifiedFileHeader(line, '+++')
}

function isRemovedLine(line: string) {
  return line.startsWith('-') && !isUnifiedFileHeader(line, '---')
}

function diffContent(line: string) {
  return line.slice(1)
}

export function buildSideBySideDiffRows(text: string): SideBySideDiffRow[] {
  const normalized = normalizeDiffText(text)

  if (!normalized) {
    return []
  }

  const lines = normalized.split('\n')
  const rows: SideBySideDiffRow[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (isRemovedLine(line)) {
      const removedLines: string[] = []
      const addedLines: string[] = []

      while (index < lines.length && isRemovedLine(lines[index])) {
        removedLines.push(diffContent(lines[index]))
        index += 1
      }

      while (index < lines.length && isAddedLine(lines[index])) {
        addedLines.push(diffContent(lines[index]))
        index += 1
      }

      index -= 1

      const rowCount = Math.max(removedLines.length, addedLines.length)

      for (let offset = 0; offset < rowCount; offset += 1) {
        const oldText = removedLines[offset]
        const newText = addedLines[offset]

        if (oldText !== undefined && newText !== undefined) {
          rows.push({ kind: 'changed', oldText, newText })
        } else if (oldText !== undefined) {
          rows.push({ kind: 'removed', oldText, newText: '' })
        } else if (newText !== undefined) {
          rows.push({ kind: 'added', oldText: '', newText })
        }
      }

      continue
    }

    if (isAddedLine(line)) {
      rows.push({ kind: 'added', oldText: '', newText: diffContent(line) })

      continue
    }

    if (line.startsWith(' ')) {
      const content = diffContent(line)
      rows.push({ kind: 'context', oldText: content, newText: content })

      continue
    }

    rows.push({ kind: 'meta', meta: line })
  }

  return rows
}
