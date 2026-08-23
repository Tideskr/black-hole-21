/* Static-only deployment intentionally uses full document navigation between prerendered routes. */
/* eslint-disable @next/next/no-html-link-for-pages */

interface SiteHeaderProps { active: 'game' | 'proof'; }

export function SiteHeader({ active }: SiteHeaderProps) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="21 黑洞游戏首页">
        <span className="brand-mark" aria-hidden="true">21</span>
        <span>BLACK HOLE</span>
      </a>
      <nav aria-label="主导航">
        <a className={active === 'game' ? 'active' : ''} href="/">对局</a>
        <a className={active === 'proof' ? 'active' : ''} href="/proof">证明</a>
        <a href="https://github.com/Tideskr/black-hole-21" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </header>
  );
}
