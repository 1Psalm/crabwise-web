import { describe, expect, it } from 'vitest'
import { authKeys } from './auth/queryKeys'
import { commissionKeys } from './commissions/queryKeys'
import { marketplaceKeys } from './marketplace/queryKeys'
import { messageKeys } from './messaging/queryKeys'
import { notificationKeys } from './notifications/queryKeys'
import { orderKeys } from './orders/queryKeys'
import { paymentKeys } from './payments/queryKeys'
import { portfolioKeys } from './portfolio/queryKeys'
import { transactionKeys } from './transactions/queryKeys'

/**
 * Query-key well-formedness baseline (issue #802).
 *
 * Each feature owns a `queryKeys.ts` factory. Divergent or colliding root
 * namespaces cause silent cache bugs (a wallet unlink that never invalidates
 * the dependent list, two components keyed the same with different shapes).
 * These assertions pin the two invariants every factory must honour: a
 * non-empty root, and a root that is unique across features.
 */
const FACTORIES: Record<string, { all: readonly unknown[] }> = {
  authKeys,
  commissionKeys,
  marketplaceKeys,
  messageKeys,
  notificationKeys,
  orderKeys,
  paymentKeys,
  portfolioKeys,
  transactionKeys,
}

describe('feature query-key factories', () => {
  it('each exposes a non-empty readonly root tuple', () => {
    for (const [name, factory] of Object.entries(FACTORIES)) {
      expect(Array.isArray(factory.all), `${name}.all must be an array`).toBe(true)
      expect(factory.all.length, `${name}.all must not be empty`).toBeGreaterThan(0)
      expect(typeof factory.all[0], `${name}.all[0] must be a string root`).toBe('string')
    }
  })

  it('uses a distinct root namespace per feature', () => {
    const roots = Object.entries(FACTORIES).map(([name, factory]) => ({
      name,
      root: factory.all[0],
    }))
    const seen = new Map<unknown, string>()
    const collisions: string[] = []

    for (const { name, root } of roots) {
      const previous = seen.get(root)
      if (previous) collisions.push(`"${String(root)}" shared by ${previous} and ${name}`)
      else seen.set(root, name)
    }

    expect(collisions, `query-key root collisions:\n${collisions.join('\n')}`).toEqual([])
  })
})

describe('messageKeys', () => {
  it('keys every thread separately', () => {
    expect(messageKeys.thread('a')).not.toEqual(messageKeys.thread('b'))
    expect(messageKeys.messages('a')).not.toEqual(messageKeys.messages('b'))
  })

  it('keys every page of a thread separately', () => {
    expect(messageKeys.page('a', 1)).not.toEqual(messageKeys.page('a', 2))
    expect(messageKeys.page('a', 1)).not.toEqual(messageKeys.page('b', 1))
  })

  it('nests a page under its thread so invalidating a thread drops its pages', () => {
    const thread = messageKeys.thread('a')
    const page = messageKeys.page('a', 3)

    expect(page.slice(0, thread.length)).toEqual([...thread])
  })
})

describe('notificationKeys', () => {
  it('selects a separate key per signed-in identity', () => {
    expect(notificationKeys.user('user-a')).not.toEqual(notificationKeys.user('user-b'))
    expect(notificationKeys.list('user-a')).not.toEqual(notificationKeys.list('user-b'))
    expect(notificationKeys.unreadCount('user-a')).not.toEqual(
      notificationKeys.unreadCount('user-b'),
    )
  })

  it('nests lists and unread counts under their user scope', () => {
    const user = notificationKeys.user('user-a')

    expect(notificationKeys.list('user-a').slice(0, user.length)).toEqual([...user])
    expect(notificationKeys.unreadCount('user-a').slice(0, user.length)).toEqual([...user])
  })

  it('keeps every filter combination apart', () => {
    expect(notificationKeys.list('user-a', { page: 1 })).not.toEqual(
      notificationKeys.list('user-a', { page: 2 }),
    )
    expect(notificationKeys.list('user-a', { types: ['order'] })).not.toEqual(
      notificationKeys.list('user-a', { types: ['message'] }),
    )
  })
})
