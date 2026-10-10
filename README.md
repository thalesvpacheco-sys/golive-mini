# GoLive Mini

Sala de tela/câmera/áudio em grupo, sem cadastro, self-hosted.

## Estrutura do projeto

```
.
├── server.js              # Express + Socket.io (signaling) + PeerServer
├── .env.example           # variáveis de ambiente (copie pra .env)
├── Dockerfile             # imagem do app
├── docker-compose.yml     # deploy na VPS: app + coturn (TURN) + Caddy (HTTPS)
├── deploy/                # Caddyfile + passo a passo do deploy
└── public/
    ├── index.html          # markup (regiões do bento)
    ├── css/style.css       # estilo, tokens OKLCH e o grid do bento
    └── js/
        ├── app.js          # ponto de entrada, liga os botões
        ├── state.js        # estado global + referências de DOM
        ├── room.js         # entrar/sair da sala, signaling, peer connections
        ├── participants.js # blocos de câmera/tela de cada pessoa
        ├── layout.js       # grade / foco / faixa / mini janela no palco, estilo Discord
        ├── popout.js       # abre o palco numa janela separada (Picture-in-Picture)
        ├── view-size.js    # resolução da câmera conforme o tamanho em que cada um vê
        ├── controls.js     # mic, câmera, reações e toasts
        ├── screen-share.js # tela numa conexão própria + teto de bitrate + áudio estéreo
        ├── user-menu.js    # botão direito numa pessoa: volume da voz e da transmissão
        ├── volumes.js      # lembra o volume escolhido pra cada pessoa
        ├── network-stats.js # RTT, perda e resolução real via getStats() + auto-degrade
        ├── panels.js       # estado dos painéis (coluna no desktop, gaveta no celular)
        ├── popovers.js     # escolha de qualidade e tema (abrir/fechar é nativo)
        ├── fullscreen.js   # move a UI pra dentro de #stage em tela cheia
        ├── shortcuts.js    # atalhos de teclado (M / F / C / G / H / P / 1–9 / Esc)
        ├── chat.js         # mensagens do chat (sem histórico)
        ├── audio-level.js  # detecta quem está falando de verdade (RMS)
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
(ver [Deploy](#deploy-vps)) — em HTTP puro
o navegador bloqueia a câmera/tela.

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais:

- `PORT` — porta do servidor (no docker compose é fixada em 3000).
- `MAX_ROOM_SIZE` — limite de pessoas por sala (padrão 8).
- `DOMAIN` / `TURN_SECRET` / `TURN_EXTERNAL_IP` — deploy na VPS (ver abaixo).
- `TURN_URLS` + `TURN_SECRET` (ou `TURN_USERNAME` / `TURN_CREDENTIAL`) — TURN,
  usado quando a conexão P2P direta falha (NAT simétrico, wifi corporativo).
  Sem isso, o app usa só STUN público — funciona na maioria dos casos.

## Deploy (VPS)

Uma VPS roda tudo com `docker compose up -d --build`: o app, um TURN próprio
(coturn, sem prazo de validade) e o Caddy com HTTPS automático. Passo a passo
(Oracle Cloud grátis, subdomínio no Registro.br, portas) em
[`deploy/README.md`](deploy/README.md).
