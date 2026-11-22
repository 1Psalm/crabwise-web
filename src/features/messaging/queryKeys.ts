/**
 * Messaging cache keys.
 *
 * Each thread gets its own subtree and every page below it, so paginating one
 * conversation can never read or overwrite another thread's cached messages.
 */
export const messageKeys = {
  all: ['messages'] as const,
  threads: () => [...messageKeys.all, 'threads'] as const,
  thread: (id: string) => [...messageKeys.threads(), id] as const,
  messages: (threadId: string) => [...messageKeys.thread(threadId), 'messages'] as const,
  page: (threadId: string, page: number) => [...messageKeys.messages(threadId), page] as const,
}
