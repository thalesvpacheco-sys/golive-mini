# GoLive Mini

Sala de tela/câmera/áudio em grupo, sem cadastro, self-hosted.

## Estrutura do projeto

```
.
├── server.js              # Express + Socket.io (signaling) + PeerServer
├── .env.example           # variáveis de ambiente (copie pra .env)
└── public/
    ├── index.html          # markup
    ├── css/style.css       # estilo
    └── js/
        ├── app.js          # ponto de entrada, liga os botões
        ├── state.js        # estado global + referências de DOM
        ├── room.js         # entrar/sair da sala, signaling, peer connections
        ├── participants.js # bolhas de câmera e palco central
        └── controls.js     # mic, câmera, tela e reações
```

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
(Railway, Render, um VPS com Caddy/Nginx + Let's Encrypt, etc.) — em HTTP puro
o navegador bloqueia a câmera/tela.

## Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais:

- `PORT` — porta do servidor (o Railway injeta a dele própria automaticamente).
- `MAX_ROOM_SIZE` — limite de pessoas por sala (padrão 8).
- `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` — servidor TURN opcional,
  usado quando a conexão P2P direta falha (NAT simétrico, wifi corporativo).
  Sem isso, o app usa só STUN público — funciona na grande maioria dos casos.

## Deploy (Railway)

Auto Deploy habilitado: push na `main` redeploya sozinho. Configure as
variáveis de ambiente acima no painel do serviço se quiser mudar os padrões.

## Limites conhecidos

- **Topologia mesh:** funciona bem até ~4-6 pessoas por sala (`MAX_ROOM_SIZE`
  bloqueia entradas além do limite configurado). Acima disso o upload de quem
  compartilha tela sofre (cada peer é uma conexão separada).
- **Estado em memória:** a lista de quem está em cada sala vive só na RAM do
  processo. Um redeploy/restart do servidor derruba todo mundo (precisa
  reentrar na sala, mas nada é perdido além disso).
- **Sem persistência/autenticação:** qualquer pessoa com o ID da sala entra.
  Suficiente pro uso pessoal, mas não é pensado pra uso público.
