import { useCallback, useEffect, useRef, useState } from 'react'

import { computeWorkspaceFileReferenceSuggestions } from '@spirit-agent/host-internal/workspace-file-reference-query'

import type { WorkspaceFileReferenceIndexSnapshot } from '@/types'

const INDEX_POLL_INTERVAL_MS = 50
const INDEX_PRIME_RETRY_POLLS = 40

type UseWorkspaceFileIndexOptions = {
  workspaceRoot: string
  workspaceBinding: 'project' | 'none'
  primeWorkspaceFileReferenceIndex(): Promise<void>
  getWorkspaceFileReferenceIndex(): Promise<WorkspaceFileReferenceIndexSnapshot>
}

export function useWorkspaceFileIndex({
  workspaceRoot,
  workspaceBinding,
  primeWorkspaceFileReferenceIndex,
  getWorkspaceFileReferenceIndex,
}: UseWorkspaceFileIndexOptions) {
  const filesRef = useRef<string[]>([])
  const [ready, setReady] = useState(false)
  const [fileCount, setFileCount] = useState(0)

  useEffect(() => {
    if (workspaceBinding !== 'project' || workspaceRoot.trim().length === 0) {
      filesRef.current = []
      setReady(false)
      setFileCount(0)
      return
    }

    let cancelled = false
    filesRef.current = []
    setReady(false)
    setFileCount(0)

    const poll = async () => {
      let pollsSincePrime = 0

      const requestPrime = () => {
        pollsSincePrime = 0
        void primeWorkspaceFileReferenceIndex().catch(() => undefined)
      }

      requestPrime()

      while (!cancelled) {
        try {
          const snapshot = await getWorkspaceFileReferenceIndex()
          if (cancelled) {
            return
          }
          if (snapshot.ready) {
            filesRef.current = snapshot.files
            setFileCount(snapshot.files.length)
            setReady(true)
            return
          }
        } catch {
          // 索引构建中或宿主未就绪，继续轮询。
        }

        pollsSincePrime += 1
        if (pollsSincePrime >= INDEX_PRIME_RETRY_POLLS) {
          requestPrime()
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, INDEX_POLL_INTERVAL_MS)
        })
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [
    getWorkspaceFileReferenceIndex,
    primeWorkspaceFileReferenceIndex,
    workspaceBinding,
    workspaceRoot,
  ])

  const search = useCallback((query: string): string[] => {
    if (!ready || filesRef.current.length === 0) {
      return []
    }
    return computeWorkspaceFileReferenceSuggestions(query, filesRef.current)
  }, [ready, fileCount])

  return {
    ready,
    fileCount,
    search,
  }
}
