# 21 · Black Hole

一个 21 格抽象数字策略游戏，以及一份可复现的计算机辅助先手必胜证明。

- 网站：`https://21.skr.moe`
- AI 先手：第 1–4 手查询 v6 策略证书，之后由 C/WASM alpha-beta 精确搜索到终局。
- 真人先手：约 2 秒 MCTS，剩余不超过 10 格时精确搜索；这一模式明确不声称已有后手不败证明。
- 本地双人：同一设备轮流落子；AI 模式可撤回到上一真人决策点，双人模式可撤销上一手。
- 局势曲线：AI 对局仅在 AI 完成回应后记录，双人对局双方每次落子都记录；用胜／和／负区间和终局分差构造 0–100 优势指数，它不是统计胜率。
- 规则：双方依次放下 1–10，最后一格为黑洞；黑洞邻格数字之和较大者输，相等为平局。

## 目录

```text
strategy/  v6 策略证书（唯一事实来源）
proof/     Python 与 Colab 证明程序
engine/    C 搜索引擎和 WebAssembly 构建
app/       React/Vinext 网站
scripts/   证书校验与运行时资产生成
```

网站不会维护一份手抄策略。`npm run prepare:strategy` 会检查原始证书的 SHA-256、20 × 18 × 16 个分支和所有落子合法性，再把精简数据写入 `public/generated/`。

## 本地运行

需要 Node.js 22+ 和 Emscripten 6.0.8：

```bash
git clone https://github.com/Tideskr/black-hole-21.git
cd black-hole-21
npm install
```

按照 [Emscripten SDK 安装说明](https://emscripten.org/docs/getting_started/downloads.html) 安装并激活 `6.0.8`，确认 `emcc --version` 可用，然后：

```bash
npm run build:wasm
npm run dev
```

浏览器打开 `http://localhost:3000`。完整验证使用：

```bash
npm run build
npm test
npm run lint
```

## GitHub Actions 自动部署

仓库已经包含 `.github/workflows/deploy.yml`。它会在 `main` 更新后校验证书、编译 WASM、构建静态网站并部署到 Cloudflare Workers Static Assets。

1. 登录 Cloudflare，打开 **My Profile → API Tokens → Create Token**。
2. 选用 **Edit Cloudflare Workers** 模板，令牌只授予实际部署账户。
3. 在 Cloudflare 控制台右侧或执行 `npx wrangler whoami` 找到 Account ID。
4. 打开 GitHub 仓库的 **Settings → Secrets and variables → Actions**，创建：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
5. 打开 **Actions → Deploy to Cloudflare → Run workflow**。首次成功后会得到 `black-hole-21.<账户>.workers.dev` 地址。

不要把令牌或 Account ID 写进源码、提交记录或公开日志。

## 绑定 `21.skr.moe`

`skr.moe` 已使用 Cloudflare 名称服务器，因此不需要更换 DNS 托管方。

1. 先在 **DNS → Records** 搜索 `21`，确认它没有承载现有服务；不要直接覆盖不明记录。
2. 打开 **Workers & Pages → black-hole-21 → Settings → Domains & Routes**。
3. 选择 **Add → Custom Domain**，输入 `21.skr.moe` 并确认。
4. Cloudflare 会建立代理 DNS 记录并签发 HTTPS 证书。等待状态变为 Active 后访问 `https://21.skr.moe`。
5. 验证首页、`/proof`、刷新子页面、WASM AI 落子和移动端布局。

若名称已经被其他 Worker 或 DNS 记录使用，先查明原用途，再决定迁移；本项目不会自动删除现有记录。

## 证明复现

快速结构检查由每次构建自动运行。完整的 6,153 个残局重新搜索不会放进普通 CI，可在 GitHub Actions 手动运行 **Re-run full proof**，或参见 [`proof/README.md`](proof/README.md)。

## 许可证

[MIT](LICENSE)
