'use client';

import { ProofExplorer } from '../components/ProofExplorer';
import { SiteHeader } from '../components/SiteHeader';
import { useI18n } from '../i18n';

const sha = 'db99816cc75f3fc5ee50939af8cd8fdf20faf0872e10df0da4705d45d35b4cca';

export default function ProofPage() {
  const { t } = useI18n();
  return (
    <main className="site-shell proof-page">
      <SiteHeader active="proof" />
      <section className="proof-hero">
        <div className="proof-title">
          <p className="eyebrow">{t('proof.eyebrow')}</p>
          <h1>{t('proof.title')}</h1>
          <p>{t('proof.subtitle')}</p>
        </div>
        <div className="quantifiers" aria-label={t('proof.quantifierLabel')}>
          <span>∀ A₁</span><i>→</i><strong>∃ H₂</strong><i>→</i><span>∀ A₂</span><i>→</i><strong>∃ H₃</strong><i>→</i><span>∀ A₃</span><i>→</i><strong>∃ H₄</strong>
        </div>
      </section>

      <section className="proof-stats" aria-label={t('proof.statsLabel')}>
        <div><strong>20</strong><span>{t('proof.firstBranches')}</span></div>
        <div><strong>6,153</strong><span>{t('proof.exactCalls')}</span></div>
        <div><strong>33.37B</strong><span>{t('proof.nodes')}</span></div>
        <div><strong>34:12</strong><span>{t('proof.time')}</span></div>
      </section>

      <section className="proof-explanation">
        <div>
          <span className="kicker">{t('proof.what')}</span>
          <h2>{t('proof.coverTitle')}</h2>
        </div>
        <div className="proof-copy">
          <p>{t('proof.coverBody')}</p>
          <p>{t('proof.caveat')}</p>
        </div>
      </section>

      <ProofExplorer />

      <section className="certificate-card">
        <div>
          <span className="kicker">{t('proof.integrity')}</span>
          <h2>{t('proof.currentCertificate')}</h2>
        </div>
        <div className="certificate-details">
          <code>{sha}</code>
          <p>{t('proof.integrityBody')}</p>
          <a href="https://github.com/Tideskr/black-hole-21/tree/main/strategy">{t('proof.sourceLink')}</a>
        </div>
      </section>
    </main>
  );
}
