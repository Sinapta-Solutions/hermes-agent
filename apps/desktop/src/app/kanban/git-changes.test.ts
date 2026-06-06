import { describe, expect, it } from 'vitest'

import type { KanbanGitChangeFile, KanbanGitRepository } from '@/hermes'

import {
  commitPathsForGitChanges,
  nextSelectedGitChangePath,
  selectedGitRepositoryId
} from './git-changes'

const repos: KanbanGitRepository[] = [
  { id: 'repo-a', label: 'A', path: 'C:/repo-a', source: 'board' },
  { id: 'repo-b', label: 'B', path: 'C:/repo-b', source: 'task' }
]

const files: KanbanGitChangeFile[] = [
  { path: 'credentials.json', status: 'untracked', raw_status: '??', staged: false, sensitive: true },
  { path: 'src/app.ts', status: 'modified', raw_status: ' M', staged: false, sensitive: false }
]

describe('kanban git changes helpers', () => {
  it('keeps the selected repository while it is still available', () => {
    expect(selectedGitRepositoryId(repos, 'repo-b')).toBe('repo-b')
    expect(selectedGitRepositoryId(repos, 'missing')).toBe('repo-a')
    expect(selectedGitRepositoryId([], 'missing')).toBeNull()
  })

  it('keeps the selected file or falls back to the first non-sensitive file', () => {
    expect(nextSelectedGitChangePath(files, 'src/app.ts')).toBe('src/app.ts')
    expect(nextSelectedGitChangePath(files, 'missing.ts')).toBe('src/app.ts')
    expect(nextSelectedGitChangePath([{ ...files[0] }], null)).toBe('credentials.json')
    expect(nextSelectedGitChangePath([], null)).toBeNull()
  })

  it('builds commit paths without sensitive files', () => {
    expect(commitPathsForGitChanges(files)).toEqual(['src/app.ts'])
    expect(commitPathsForGitChanges([{ ...files[0] }])).toEqual([])
  })
})
