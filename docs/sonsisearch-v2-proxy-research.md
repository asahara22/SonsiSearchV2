# SonsiSearch V2: Proxy調査と実装判断

調査日: 2026-09-24

## 結論

MVPのProxy候補には **HalcyonをベースにScramjet 2.xを採用**する。独立したNode.jsサービスとしてDockerで動かし、Render Web Serviceを最初の配置先にする。CloudflareはDNS・TLS・WAF/レート制限などの前段として使い、WorkersへProxy本体を移植しない。

HalcyonはScramjet 2.x、Wisp WebSocket、libcurl transportを組み合わせた実稼働可能なWebアプリで、DockerfileとFly.io設定が存在する。公開時に必要なパスワードゲート、接続元単位の制限、private-IP/metadata遮断、ポート制限なども実装されている。現時点で新規VPS契約は不要。

**ライセンスは選定上の必須条件。** Halcyon、Scramjet 2.x/current controller、Scramjet-AppはAGPL-3.0系。Halcyonを改変してネットワークサービスとして提供する場合、対応ソースコードを利用者へ提供する義務が生じる。SonsiSearchとしてコードを公開できない場合は採用を止め、独立した法務確認か別実装の選定を先に行う。npm上のScramjet v1.1.0パッケージはMIT表記だが、現在のScramjet 2.xとは別系統・別ライセンスなので混同しない。

## 候補比較

| 候補 | 状態 / 構成 | Docker / PaaS | ライセンスと判断 |
|---|---|---|---|
| [Scramjet](https://github.com/MercuryWorkshop/scramjet) | 活発に開発されるプロキシエンジン。現在のmainは2.x系で、ビルドにはNode/pnpmに加えてRust/WASMツールチェーンが必要。単体で完成した運用アプリではなくWisp/transport/フロントエンドを組み合わせる。 | 公式READMEは主に開発用dev serverを説明。完成したDocker運用手順ではない。Cloudflare Workers互換をうたう根拠も確認できず。 | 2.x/current controller等はAGPL-3.0-only。npmのv1.1.0はMITとして配布されているが別世代。エンジン候補として採用。 |
| [Scramjet-App](https://github.com/MercuryWorkshop/Scramjet-App) | Scramjet 1.xを使うNode.js/Fastifyアプリ。Wisp、libcurl transport、service worker、proxy UIをまとめた参考になる構成。READMEの本番例ではNode 16+、pnpm、`pnpm start`。 | Dockerfile / docker-composeあり。Render/Railwayへコンテナデプロイ可能性は高いが、現行2.xではなく1.x依存。 | AGPL系。完成アプリの構成参考としてのみ使い、古い世代をそのまま新規採用しない。 |
| [browser-proxy](https://github.com/hn63wospuvy/browser-proxy) | Rust/axum/tokio製Wisp v1 TCP relay + Scramjet 1.1 frontend。HTTP/TLSはブラウザー内のlibcurl WASMが扱い、サーバーはraw TCPを中継。READMEでWebSocket、接続/stream上限、private IP遮断の設定を説明。 | Rust 1.75+。コミット済み静的アセットを含む単一実行ファイルで起動可能。ただしリポジトリにDockerfileは見当たらず、提供READMEはコンテナ/PaaS対応を説明しない。 | リポジトリのルートにLICENSEがなく、明示ライセンスを確認できない。再利用・改変・配布の許諾が不明なので採用不可。 |
| [Halcyon](https://github.com/Novaro1/halcyon) | Scramjet 2.x + Wisp + libcurlのNodeアプリ。UI、サービスワーカー、URL bar、履歴/bookmark、Wisp backendを含む。現行Scramjet 2.x controller APIを使う。 | DockerfileおよびFly設定あり。Node `npm install` / `npm start`、ビルド工程なし。RenderのDocker Web ServiceならWebSocketを扱え、Renderは接続に固定時間上限を設けないが、deploy/restart時は切断されるので再接続設計が必要。 | AGPL-3.0。ソース公開可能性を満たせる場合の第一候補。機能範囲が広いため不要な統合機能は削り、依存を固定する。 |

## Hosting適合性

### Cloudflare Workers

WorkersはWebSocketを扱え、TCP sockets APIもあるが、そのTCPは**outbound専用**で、Workerへ直接TCP接続を受ける仕組みではない。Wispはクライアントから入るWebSocketを受け、その中の多重streamごとに外部TCPへ接続する。Workersへ移植するにはWisp relayのプロトコル処理、TCP lifecycle、WebSocket接続をWorker/Durable Objectの制約下で再実装する必要がある。現行Scramjet/Halcyonをそのまま載せる配置ではない。無理に移植しない。

### Render

Render Web Servicesはpublic WebSocketを受け入れる。WebSocketの最大接続時間は固定されていないが、deployやインスタンス交換で切断される。Dockerfileを使えるため、MVPの第一候補とする。小規模MVPでも無料枠のsleep/制約はブラウザーの持続接続と相性が悪いため、実利用時は常時起動できる有料Web Serviceが必要か料金確認する。

### Railway / Fly.io / Koyeb

RailwayはDockerコンテナ型HTTPサービス候補として次点。選定時に公開WebSocket、長時間接続の切断挙動、egress料金、カスタムドメイン、ヘルスチェック、再デプロイ時の切断を実機で確認する。Fly.ioはHalcyonに既存`fly.toml`がありDockerイメージで動かせるため、有力な代替。Koyebもコンテナ/PaaS候補だが、この調査ではWisp長時間WebSocketを根拠付きで確定できていない。契約前に実接続PoCを行う。

## セキュリティ要件とHalcyonで確認できた点

- Proxy originは本体と別ホスト (`proxy.sonsisearch...`) にする。
- `HALCYON_PASSWORD`を設定し、HTTP UIとWisp tunnel双方を認証する。認証なしの公開運用は禁止。
- `HALCYON_ALLOWED_PORTS=80,443`を維持。SMTP/SSH/DB等への汎用TCP relayにしない。
- private/loopback/link-local/metadata宛を拒否し、追加denylistを運用する。名前解決後のIP検査とDNS rebinding耐性をデプロイ前にコード確認する。
- 接続元別Wisp rate limit、同時tunnel上限を保守的に設定し、CF-Connecting-IP等のforwarded IPを信頼するのはCloudflareを経由した通信だけに限定する。
- ProxyのTLSは専用originで終端。Service Workerのsecure contextと`wss://`を必須とする。
- サイト間cookieは同一proxy originに集約され得る。Halcyon自身もScramjetを強固なセキュリティ境界とは見なしていないため、MVPで第三者サイトへのログイン利用を促さない。SonsiSearchの認証Cookieとはorigin分離する。
- ログには宛先ホストや接続元などのmetadataが出る。本文、Cookie、Authorization headerを記録しない。保持期間を短くする。
- 画像やHTMLの通常ストリーミングを維持し、動画・巨大ファイルにサイズ/帯域制限を追加する前にScramjet transportとの互換性を検証する。

## SonsiSearch統合案

```text
sonsisearch.com (Next.js / Vercel)
  /search?q=...
  /browser?url=<URL-encoded https URL>
       │
       └── Browser shell / iframe
             └── proxy.sonsisearch.com (Halcyon + Scramjet + Wisp on Render)
```

検索結果の「Open in SonsiSearch」はURLを適切にencodeして`/browser?url=`へ渡す。「Original」はtarget URLを新規タブで開く。ブラウザーの入力欄はURLならproxyへ、検索語なら`/search?q=`へ遷移する。本体がNext.jsか、検索UI・データソース・既存のルーティングが何かはこの作業ツリーにコードがないため未確認。

Convexはユーザー設定・履歴・bookmark等に将来利用する。Proxy byte streamや第三者CookieをConvexに保存しない。Halcyonのcookie/sessionは専用proxy originのブラウザー領域に置き、本体sessionから分離する。

## 次の実装ゲート

1. 実際のSonsiSearchアプリのリポジトリをこのworkspaceに用意する。現在のworkspaceには`.git`のみで、tracked file/commit/package.json/Next.js/Convex構成はない。
2. AGPL-3.0でProxy・統合コードを公開できるか決める。公開できない場合はHalcyon/Scramjet 2.xの採用を中止する。
3. Halcyonの固定commitをforkし、不要UIを除去して、認証・SSRF・rate limit・ログ方針を確認。利用する正確なScramjet/controller/transport版のライセンスと整合性を記録する。
4. Render上のPoCでHTTPS/WSS、長時間閲覧、再deploy時の再接続、上限設定、遮断試験を行い、料金とegressを確認する。
5. 安全性・互換性を確認してからNext.jsのBrowser UIと検索結果導線を統合し、実ブラウザーでPC/Android/iPhoneを確認する。

この環境にはSonsiSearchコードもRender/Cloudflareのアカウント接続もないため、今ターンではアプリコード変更や外部サービスへのデプロイは行っていない。

## 参照

- Scramjet: https://github.com/MercuryWorkshop/scramjet
- Scramjet-App: https://github.com/MercuryWorkshop/Scramjet-App
- browser-proxy: https://github.com/hn63wospuvy/browser-proxy
- Halcyon: https://github.com/Novaro1/halcyon
- Cloudflare Workers TCP sockets: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Cloudflare Workers WebSockets: https://developers.cloudflare.com/workers/runtime-apis/websockets/
- Render WebSockets: https://render.com/docs/websocket
- Render Web Services: https://render.com/docs/web-services
- Fly.io Docker images: https://fly.io/docs/reference/fly-launch/
