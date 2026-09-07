# GoLive Mini

Sala de tela/câmera/áudio em grupo, sem cadastro, self-hosted.

## Rodar localmente

```bash
npm install
npm start
```

Abre em `http://localhost:3000`, digita um ID de sala (qualquer texto, ex: `galera01`)
e manda o mesmo link + ID pros amigos.

⚠️ **Importante:** `getDisplayMedia`/`getUserMedia` só funcionam em `https://`
ou em `localhost`. Pra usar com amigos remotos, precisa hospedar com HTTPS
(Railway, Render, um VPS com Caddy/Nginx + Let's Encrypt, etc.) — em HTTP puro
o navegador bloqueia a câmera/tela.

## Limites conhecidos

- Topologia mesh: funciona bem até ~4-6 pessoas por sala. Acima disso o upload
  de quem compartilha tela sofre (cada peer é uma conexão separada).
- Sem servidor TURN: se algum amigo estiver atrás de uma rede muito fechada
  (NAT simétrico, wifi corporativo chato), a conexão pode falhar. Solução:
  adicionar um servidor TURN (ex: `coturn` ou serviços como Metered/Twilio)
  na config do `Peer()` no `index.html`.
