# Deploy numa VPS (app + TURN + HTTPS)

Uma máquina só roda tudo com `docker compose`:

- **app**: o GoLive Mini (Node)
- **caddy**: HTTPS automático (Let's Encrypt) na frente do app
- **turn**: coturn, o nosso TURN, que não expira. As credenciais são
  temporárias, geradas pelo `server.js` a cada entrada na sala.

Precisa de: uma VPS Linux com IP público e um subdomínio apontando pra ela.

## 1. VPS

Grátis: **Oracle Cloud Always Free** (oracle.com/cloud/free). Crie uma
instância **Ubuntu 24.04**; a forma `VM.Standard.A1.Flex` (ARM, 1 OCPU / 6 GB
é mais que suficiente) ou a `VM.Standard.E2.1.Micro` servem.
Pago e sem burocracia: qualquer VPS de ~€4/mês (Hetzner, Contabo etc.).

Anote o **IP público** da máquina.

## 2. Subdomínio (Registro.br)

No painel do Registro.br → domínio → **DNS** → editar zona, crie:

| Tipo | Nome   | Valor          |
|------|--------|----------------|
| A    | `live` | IP público da VPS |

Isso cria `live.seudominio.com.br` (troque `live` pelo que quiser). Se o
domínio usa DNS de outro lugar (Cloudflare, hospedagem antiga), crie o
registro lá. Na Cloudflare, deixe a **nuvem cinza** (só DNS): o proxy
laranja não deixa o TURN passar.

Confira com `nslookup live.seudominio.com.br`; pode levar alguns minutos.

## 3. Portas

| Porta           | Protocolo | Pra quê          |
|-----------------|-----------|------------------|
| 80, 443         | TCP       | HTTP/HTTPS       |
| 443             | UDP       | HTTP/3 (opcional) |
| 3478            | TCP e UDP | TURN             |
| 49160–49200     | UDP       | relay do TURN    |

**Na Oracle são dois lugares**:

1. Painel: VCN → Security List → *Add Ingress Rules* (origem `0.0.0.0/0`)
   com as portas acima.
2. Dentro da VM (a imagem Ubuntu da Oracle vem com iptables fechado):

   ```bash
   sudo iptables -I INPUT -p tcp -m multiport --dports 80,443,3478 -j ACCEPT
   sudo iptables -I INPUT -p udp -m multiport --dports 443,3478 -j ACCEPT
   sudo iptables -I INPUT -p udp --dport 49160:49200 -j ACCEPT
   sudo netfilter-persistent save
   ```

Em outras VPS, normalmente basta o firewall do painel (ou `ufw`, se ligado).

## 4. Subir

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/thalesvpacheco-sys/golive-mini.git
cd golive-mini
cp .env.example .env
nano .env
```

No `.env`, preencha:

```bash
DOMAIN=live.seudominio.com.br
TURN_SECRET=          # gere com: openssl rand -hex 32
TURN_EXTERNAL_IP=     # ver abaixo
```

`TURN_EXTERNAL_IP`:
- **Oracle** (a VM fica atrás de NAT): `IP_PUBLICO/IP_PRIVADO`, ex.
  `150.230.1.2/10.0.0.15`. O privado aparece em `hostname -I`.
- **VPS comum** (o IP público está na própria máquina): só o IP público.

```bash
docker compose up -d --build
docker compose logs -f
```

Abra `https://live.seudominio.com.br`. O certificado sai sozinho no primeiro
acesso, desde que o DNS já aponte pra VPS e a porta 80 esteja aberta.

## 5. Testar o TURN

1. Abra `https://live.seudominio.com.br/api/ice-config` e copie
   `username` e `credential`.
2. Em <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>,
   remova o servidor padrão e adicione `turn:live.seudominio.com.br:3478`
   com esse usuário/senha.
3. *Gather candidates*: se aparecer uma linha **`relay`**, o TURN funciona.

Se não aparecer `relay`, quase sempre é porta fechada (passo 3) ou
`TURN_EXTERNAL_IP` errado. Veja com `docker compose logs turn`.

## Atualizar

```bash
cd golive-mini && git pull && docker compose up -d --build
```
