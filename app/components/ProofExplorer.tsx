'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RuntimeCertificate } from '../lib/game';
import { useI18n } from '../i18n';

export function ProofExplorer() {
  const { t } = useI18n();
  const [certificate, setCertificate] = useState<RuntimeCertificate | null>(null);
  const [a1, setA1] = useState('2');
  const [a2, setA2] = useState('');
  const [a3, setA3] = useState('');

  useEffect(() => { void fetch('/generated/strategy-v6.json').then((response) => response.json()).then(setCertificate); }, []);
  const branch = certificate?.fullResults[a1];
  const ai2Options = useMemo(() => branch ? Object.keys(branch.responsesByAi2).sort((a, b) => Number(a) - Number(b)) : [], [branch]);
  const selectedA2 = ai2Options.includes(a2) ? a2 : ai2Options[0] ?? '';
  const response = branch?.responsesByAi2[selectedA2];
  const ai3Options = useMemo(() => response ? Object.keys(response.h4ByAi3).sort((a, b) => Number(a) - Number(b)) : [], [response]);
  const selectedA3 = ai3Options.includes(a3) ? a3 : ai3Options[0] ?? '';

  if (!certificate || !branch || !response) return <div className="proof-explorer loading">{t('proof.loading')}</div>;
  return (
    <div className="proof-explorer">
      <div className="explorer-heading">
        <span className="kicker">{t('proof.explorerKicker')}</span>
        <h2>{t('proof.explorerTitle')}</h2>
      </div>
      <div className="branch-flow">
        <label><span>{t('proof.aiH1')}</span><strong>01</strong></label>
        <label><span>{t('proof.opponentA1')}</span><span className="select-shell"><select aria-label={t('proof.selectA1')} value={a1} onChange={(event) => { setA1(event.target.value); setA2(''); setA3(''); }}>{Object.keys(certificate.fullResults).sort((a, b) => Number(a) - Number(b)).map((cell) => <option key={cell}>{cell}</option>)}</select><i aria-hidden="true">⌄</i></span></label>
        <label><span>{t('proof.aiH2')}</span><strong>{String(branch.h2).padStart(2, '0')}</strong></label>
        <label><span>{t('proof.opponentA2')}</span><span className="select-shell"><select aria-label={t('proof.selectA2')} value={selectedA2} onChange={(event) => { setA2(event.target.value); setA3(''); }}>{ai2Options.map((cell) => <option key={cell}>{cell}</option>)}</select><i aria-hidden="true">⌄</i></span></label>
        <label><span>{t('proof.aiH3')}</span><strong>{String(response.h3).padStart(2, '0')}</strong></label>
        <label><span>{t('proof.opponentA3')}</span><span className="select-shell"><select aria-label={t('proof.selectA3')} value={selectedA3} onChange={(event) => setA3(event.target.value)}>{ai3Options.map((cell) => <option key={cell}>{cell}</option>)}</select><i aria-hidden="true">⌄</i></span></label>
        <label className="winning-witness"><span>{t('proof.aiH4')}</span><strong>{String(response.h4ByAi3[selectedA3]).padStart(2, '0')}</strong></label>
      </div>
      <p>{t('proof.explorerBody')}</p>
    </div>
  );
}
