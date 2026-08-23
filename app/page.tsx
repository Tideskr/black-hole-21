import { BlackHoleGame } from './components/BlackHoleGame';
import { SiteHeader } from './components/SiteHeader';

export default function Home() {
  return (
    <main className="site-shell">
      <SiteHeader active="game" />
      <BlackHoleGame />
    </main>
  );
}
