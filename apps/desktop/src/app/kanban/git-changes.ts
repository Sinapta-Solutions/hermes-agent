import type { KanbanGitChangeFile, KanbanGitRepository } from '@/types/hermes'

export function selectedGitRepositoryId(repositories: KanbanGitRepository[], currentId: null | string): null | string {
  if (currentId && repositories.some(repository => repository.id === currentId)) {
    return currentId
  }

  return repositories[0]?.id ?? null
}

export function nextSelectedGitChangePath(files: KanbanGitChangeFile[], currentPath: null | string): null | string {
  if (currentPath && files.some(file => file.path === currentPath)) {
    return currentPath
  }

  return files.find(file => !file.sensitive)?.path ?? files[0]?.path ?? null
}

export function commitPathsForGitChanges(files: KanbanGitChangeFile[]): string[] {
  return files.filter(file => !file.sensitive).map(file => file.path)
}
