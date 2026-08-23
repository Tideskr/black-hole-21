'use client';

import { useI18n } from '../i18n';

/* Static-only deployment intentionally uses full document navigation between prerendered routes. */
/* eslint-disable @next/next/no-html-link-for-pages */

interface SiteHeaderProps { active: 'game' | 'proof'; }

export function SiteHeader({ active }: SiteHeaderProps) {
  const { language, resolvedTheme, t, toggleLanguage, toggleTheme } = useI18n();
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label={t('nav.homeLabel')}>
        <span className="brand-mark" aria-hidden="true">21</span>
        <span>BLACK HOLE</span>
      </a>
      <div className="header-actions">
        <nav aria-label={t('nav.main')}>
          <a className={active === 'game' ? 'active' : ''} href="/">{t('nav.game')}</a>
          <a className={active === 'proof' ? 'active' : ''} href="/proof">{t('nav.proof')}</a>
          <a href="https://github.com/Tideskr/black-hole-21" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <div className="preference-controls">
          <button type="button" onClick={toggleLanguage} aria-label={t('controls.language')} title={t('controls.language')}>
            {language === 'zh' ? 'EN' : '\u4E2D'}
          </button>
          <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={resolvedTheme === 'dark' ? t('controls.themeLight') : t('controls.themeDark')} title={resolvedTheme === 'dark' ? t('controls.themeLight') : t('controls.themeDark')}>
            <span aria-hidden="true">{resolvedTheme === 'dark' ? '☀' : '◐'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
