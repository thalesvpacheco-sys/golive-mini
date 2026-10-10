# Deploy numa VPS (alternativa ao Render)

Hoje o app roda no Render (ver o README da raiz). Este caminho serve se um
dia quiserem uma máquina própria, sem o "dorme depois de 15 min" do plano
grátis.

Uma VPS roda o app e o Caddy (HTTPS automático) com `docker compose`. Áudio
e vídeo continuam no LiveKit Cloud, então não precisa abrir porta UDP nem
manter TURN.

## Passos

1. **VPS** Linux com IP público (Oracle Cloud Always Free, Hetzner etc.).
   Liberem as portas **80** e **443** (TCP) no firewall do painel.
2. **DNS**: no Registro.br, troquem o `CNAME toca` por um registro
   `A toca` → IP da VPS (apaguem o CNAME e salvem antes de criar o A).
3. **Subir**:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   git clone https://github.com/thalesvpacheco-sys/golive-mini.git
   cd golive-mini
   cp .env.example .env
   nano .env   # DOMAIN e as três variáveis LIVEKIT_*
   sudo docker compose up -d --build
   ```

4. Abram `https://toca.usagi.com.br`. O certificado sai sozinho no primeiro
   acesso.

## Atualizar

```bash
cd golive-mini && git pull && sudo docker compose up -d --build
```
