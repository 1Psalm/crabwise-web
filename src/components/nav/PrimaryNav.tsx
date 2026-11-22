import { Link, useLocation } from 'react-router-dom'
import { isNavItemCurrent, NAV_CURRENT_CLASSES, NAV_LINK_BASE } from './navFocus'

export interface NavItem {
  to: string
  label: string
  /**
   * Accessible name when the visible label is not enough on its own, e.g. a
   * notification entry that also shows an unread count.
   */
  ariaLabel?: string
}

const DEFAULT_ITEMS: NavItem[] = [
  { to: '/artists/elena_art', label: 'Featured Artist' },
  { to: '/artists/stellar_nova', label: 'Explore Creators' },
]

/**
 * Desktop primary navigation with visible keyboard focus indicators (#939).
 */
export function PrimaryNav({ items = DEFAULT_ITEMS }: { items?: NavItem[] }) {
  const { pathname } = useLocation()

  return (
    <nav aria-label="Primary" className="hidden sm:flex items-center gap-4">
      {items.map((item) => {
        const isCurrent = isNavItemCurrent(pathname, item.to)

        return (
          <Link
            key={item.to}
            to={item.to}
            className={`${NAV_LINK_BASE}${isCurrent ? ` ${NAV_CURRENT_CLASSES}` : ''}`}
            aria-label={item.ariaLabel ?? item.label}
            aria-current={isCurrent ? 'page' : undefined}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
