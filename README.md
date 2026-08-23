# 21 · Black Hole

A bilingual implementation of the 21-cell abstract number strategy game, together with a reproducible computer-assisted proof that the first player can force a win.

- Website: <https://21.skr.moe>
- Languages: Simplified Chinese and English, selected from the browser language and remembered locally.
- Themes: system-aware light and dark themes with a persistent manual override.
- AI first: moves 1–4 come from the proven strategy certificate; later moves use exact C/WASM alpha-beta search.
- Human first: the AI uses an approximately two-second MCTS search for its first three moves and exact search from its fourth reply. This experimental mode does **not** claim that the second player can avoid losing.
- Local two-player: both players share one device. AI games undo to the previous human decision; local games undo one move.
- Position status: reports whether the first player can win, draw, or cannot avoid losing under perfect play, while noting that later mistakes can change the practical result.
- Exact analysis: late positions show the current player's non-losing move rate and win/draw/loss branch counts. AI-first games instead show the scoring margin the AI can guarantee against perfect defense.
- Hints: every decision is precomputed in a separate Web Worker and revealed only after the user selects **Show hint**. First-player moves 1–4 use the proven certificate, move 5 bridges into exact alpha-beta search, and exact endgame analysis then takes over.
- Rules: both players place 1 through 10 in order. The final empty cell is the black hole; the player with the larger sum around it loses, and equal sums draw.

## Repository layout

```text
strategy/  v6 strategy certificate, the sole certificate source of truth
proof/     Python/Numba prover and Google Colab launcher
engine/    C search engine and WebAssembly build
app/       React/Vinext website
scripts/   certificate validation and static-build preparation
```

The website never carries a hand-copied strategy table. `npm run prepare:strategy` verifies the source certificate's SHA-256, all `20 × 18 × 16` branches, and move legality before generating compact runtime data in `public/generated/`.

## Local development

Node.js 22+ and Emscripten 6.0.8 are required:

```bash
git clone https://github.com/Tideskr/black-hole-21.git
cd black-hole-21
npm install
```

Install and activate Emscripten SDK 6.0.8 using the [official instructions](https://emscripten.org/docs/getting_started/downloads.html), confirm that `emcc --version` works, then run:

```bash
npm run build:wasm
npm run dev
```

Open <http://localhost:3000>. The full fast validation suite is:

```bash
npm run build
npm test
npm run lint
```

## Reproducing the full proof

Normal builds perform a fast structural certificate check. The complete 6,153 exact endgame searches are intentionally excluded from ordinary CI. Run the manual **Re-run full proof** GitHub Actions workflow, or execute:

```bash
python -m pip install numpy numba
python -c "from proof.prove_first_player import run_proof; ok,_=run_proof(workers=4, checkpoint_path='proof-output-v6.json', previous_checkpoint_path=None); raise SystemExit(0 if ok else 1)"
```

See [`proof/README.md`](proof/README.md) for details.

## GitHub Actions deployment

The repository includes `.github/workflows/deploy.yml`. Every update to `main` validates the certificate, compiles WASM, builds the static site, runs tests and lint, then deploys to Cloudflare Workers Static Assets.

1. Sign in to Cloudflare and open **My Profile → API Tokens → Create Token**.
2. Start from the **Edit Cloudflare Workers** template and restrict the token to the deployment account.
3. Find the Account ID in the Cloudflare dashboard or with `npx wrangler whoami`.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. Open **Actions → Deploy to Cloudflare → Run workflow**. The first successful run creates a `workers.dev` URL.

Never commit the API token or Account ID, and never expose them in public logs.

## Custom domain

`skr.moe` already uses Cloudflare nameservers, so no DNS-provider migration is required.

1. In **DNS → Records**, check whether `21` already serves a real workload. Do not overwrite an unknown record.
2. Open **Workers & Pages → black-hole-21 → Settings → Domains & Routes**.
3. Select **Add → Custom Domain**, enter `21.skr.moe`, and confirm.
4. Cloudflare creates the proxied DNS record and provisions HTTPS. Wait for the status to become **Active**.
5. Verify `/`, `/proof`, direct route refreshes, WASM AI moves, both languages, both themes, and the mobile layout.

If the hostname already belongs to another Worker or DNS record, identify its owner and migration plan first. This project never deletes an existing record automatically.

## License

[MIT](LICENSE)
