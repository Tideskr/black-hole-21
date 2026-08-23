import { BlackHoleGame } from './components/BlackHoleGame';
import { SiteHeader } from './components/SiteHeader';

export default function Home() {
  return (
    <main className="site-shell">
      <SiteHeader active="game" />
      <section className="game-intro compact">
        <p className="eyebrow">COMPUTER-AIDED STRATEGY · V6</p>
        <h1>把数字留在黑洞之外。</h1>
        <p>21 个位置，双方依次放下 1—10。最后一格成为黑洞，邻格数字之和更小的一方获胜。</p>
      </section>
      <BlackHoleGame />
    </main>
  );
}
