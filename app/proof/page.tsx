import { ProofExplorer } from '../components/ProofExplorer';
import { SiteHeader } from '../components/SiteHeader';

const sha = 'f699006e057352a366f777276cc00c711464f499450d6a23521d4a61720c812b';

export default function ProofPage() {
  return (
    <main className="site-shell proof-page">
      <SiteHeader active="proof" />
      <section className="proof-hero">
        <p className="eyebrow">A FINITE, CHECKABLE CLAIM</p>
        <h1>先手必胜，不靠猜。</h1>
        <p>v6 证书给出前四手的策略见证；每个叶子局面再由 alpha-beta 完整搜索到终局。</p>
        <div className="quantifiers" aria-label="证明量词结构">
          <span>∀ A₁</span><i>→</i><strong>∃ H₂</strong><i>→</i><span>∀ A₂</span><i>→</i><strong>∃ H₃</strong><i>→</i><span>∀ A₃</span><i>→</i><strong>∃ H₄</strong>
        </div>
      </section>

      <section className="proof-stats" aria-label="证明统计">
        <div><strong>20</strong><span>首回合完整分支</span></div>
        <div><strong>6,153</strong><span>精确残局调用</span></div>
        <div><strong>33.37B</strong><span>搜索节点</span></div>
        <div><strong>34:12</strong><span>本地 4 核耗时</span></div>
      </section>

      <section className="proof-explanation">
        <div>
          <span className="kicker">WHAT IS PROVED</span>
          <h2>固定 H1=1，覆盖对手每一种回应。</h2>
        </div>
        <div className="proof-copy">
          <p>这里的 H 代表采用证书的先手，A 代表任意对手。对手的第 1 手有 20 种；证书为每一种情况指定同一个能覆盖后续全部回应的 H2，并继续给出 H3 与 H4。</p>
          <p>JSON 是策略见证与计算结果记录，并不是无需计算即可验证的形式化证明树。独立复核者需要重新运行公开的证明程序，才能重新确认所有残局搜索结论。</p>
        </div>
      </section>

      <ProofExplorer />

      <section className="certificate-card">
        <span className="kicker">INTEGRITY</span>
        <h2>策略版本 6</h2>
        <code>{sha}</code>
        <p>网站每次构建都会检查这个 SHA-256，并验证 20 × 18 × 16 个映射的完整性和落子合法性。</p>
        <a href="https://github.com/Tideskr/black-hole-21/tree/main/strategy">查看原始证书与复现代码 ↗</a>
      </section>
    </main>
  );
}
