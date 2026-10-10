# GoLive Mini

Sala de tela/câmera/áudio em grupo, sem cadastro.

Áudio, vídeo e tela passam pelo [LiveKit](https://livekit.io) (um SFU: cada
pessoa manda a câmera uma vez pro servidor, que distribui pra sala). Por isso
uma sala aguenta até 30 pessoas. Chat, reações e apontador vão pelo Socket.io
do próprio servidor.

## Estrutura do projeto

```
.
├── server.js              # Express + token do LiveKit + Socket.io (chat/reações)
├── .env.example           # variáveis de ambiente (copie pra .env)
├── Dockerfile             # imagem do app
├── docker-compose.yml     # deploy alternativo em VPS: app + Caddy (HTTPS)
├── deploy/                # Caddyfile + passo a passo do deploy em VPS
└── public/
    ├── index.html          # markup (regiões do bento)
    ├── css/style.css       # estilo, tokens OKLCH e o grid do bento
    └── js/
        ├── app.js          # ponto de entrada, liga os botões
        ├── state.js        # estado global + referências de DOM
        ├── room.js         # entrar/sair da sala, conexão com o LiveKit
        ├── participants.js # blocos de câmera/tela de cada pessoa
        ├── layout.js       # grade / foco / faixa / mini janela no palco, estilo Discord
        ├── popout.js       # abre o palco numa janela separada (Picture-in-Picture)
        ├── controls.js     # mic, câmera, reações e toasts
        ├── screen-share.js # tela numa faixa própria + teto de bitrate + áudio estéreo
        ├── user-menu.js    # botão direito numa pessoa: volume da voz e da transmissão
        ├── volumes.js      # lembra o volume escolhido pra cada pessoa
        ├── network-stats.js # RTT, perda e resolução real + auto-degrade
        ├── panels.js       # estado dos painéis (coluna no desktop, gaveta no celular)
        ├── popovers.js     # escolha de qualidade e tema (abrir/fechar é nativo)
        ├── fullscreen.js   # move a UI pra dentro de #stage em tela cheia
        ├── shortcuts.js    # atalhos de teclado (M / F / C / G / H / P / 1–9 / Esc)
        ├── chat.js         # mensagens do chat (sem histórico)
        ├── quality.js      # presets de resolução/fps do compartilhamento
        ├── theme.js        # troca de tema (grafite / claro / preto)
        ├── i18n.js         # textos pt/en + detecção de idioma
        └── gradient-bg.js  # fundo animado da tela de entrada
```

## Layout

A tela de chamada é um bento de 3 colunas × 3 linhas: participantes à
esquerda, chat à direita, e a coluna central empilhando config (topo), palco
e controles. As colunas laterais são custom properties registradas com
`@property`, o que as torna animáveis — abrir/fechar um painel desliza a
coluna em vez de saltar. Abaixo de 1080px os painéis viram gaveta por cima
do vídeo; o JS não sabe da diferença, só liga `data-people`/`data-chat` no
`#app` e o CSS decide o que "aberto" significa.

## Rodar localmente

```bash
npm install
cp .env.example .env   # ajuste se precisar
npm run dev            # com reload automático (nodemon)
# ou: npm start
```

Abre em `http://localhost:3000`, digita um ID de sala (letras, números, `-`/`_`,
ex: `galera01`) e manda o mesmo link + ID pros amigos.

⚠️ **Importante:** `getDisplayMedia`/`getUserMedia` só funcionam em `https://`
ou em `localhost`. Pra usar com amigos remotos, precisa hospedar com HTTPS
(ver [Deploy](#deploy)) — em HTTP puro
o navegador bloqueia a câmera/tela.

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais:

- `PORT` — porta do servidor (o Render injeta a dele; no docker compose é 3000).
- `MAX_ROOM_SIZE` — limite de pessoas por sala (padrão 30).
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` — projeto do
  LiveKit Cloud (*Settings → API Keys*). Sem isso ninguém entra na sala.
  Pra testar local sem conta, rode `livekit-server --dev` e use
  `ws://localhost:7880`, `devkey` e `secret`.

## Deploy

### Produção atual: Render + LiveKit Cloud

No ar em **https://toca.usagi.com.br**.

- **App:** Render, plano Free, serviço `golive-mini`, branch `main`.
  Build `npm install`, start `node server.js`. Todo push na `main`
  redeploya sozinho.
  - Depois de 15 min sem ninguém, o serviço dorme e o primeiro acesso leva
    ~1 min pra acordar. Durante uma chamada ele não dorme (o Socket.io manda
    sinal a cada 25s).
- **Mídia:** LiveKit Cloud, projeto `toca`, plano grátis. Ele já traz TURN
  próprio, então o ExpressTURN não é mais usado. No Render, em
  *Environment*:

  | Variável | Valor |
  |---|---|
  | `LIVEKIT_URL` | `wss://….livekit.cloud` (aparece em *Settings* do projeto) |
  | `LIVEKIT_API_KEY` | chave criada em *Settings → API Keys* |
  | `LIVEKIT_API_SECRET` | segredo da mesma chave |
  | `MAX_ROOM_SIZE` | opcional, padrão 30 |

  O uso (minutos de participante) aparece em *Usage* no painel do LiveKit.
- **Domínio:** no Registro.br (zona DNS de `usagi.com.br`), um `CNAME`
  `toca` → `golive-mini.onrender.com`. No Render, o domínio está em
  *Settings → Custom Domains*, e o HTTPS é automático.

### Alternativa: VPS própria

Se um dia quiserem sair do Render: uma VPS roda o app e o Caddy (HTTPS
automático) com `docker compose up -d --build`, e a mídia continua no
LiveKit Cloud. O passo a passo está em [`deploy/README.md`](deploy/README.md).
