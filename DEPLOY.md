# Deploy en Fly.io — GPTW Sales Bot

Guía paso a paso para levantar el bot en [Fly.io](https://fly.io).

## Requisitos

- Cuenta en Fly.io con `flyctl` instalado: `curl -L https://fly.io/install.sh | sh`
- Cuenta Claude Max ($20/mes en https://claude.ai/upgrade) — necesaria para que el bot use Claude Sonnet
- Bun instalado localmente para probar: `curl -fsSL https://bun.sh/install | bash`

## 1. Clonar el repo y configurar variables

```bash
git clone https://github.com/chetyz/gptw-sales-bot.git
cd gptw-sales-bot
cp .env.example .env
# editá .env con las credenciales que te pasen aparte (Salesforce + GPTW_ACCESS_TOKEN)
bun install
```

Las credenciales de Salesforce y el `GPTW_ACCESS_TOKEN` se entregan por un canal seguro (NO van al repo).

## 2. Crear el `Dockerfile` en la raíz del proyecto

```dockerfile
FROM oven/bun:1.1-debian
RUN apt-get update && apt-get install -y curl tmux ca-certificates && \
    curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY . .
EXPOSE 8787
CMD ["bash", "-lc", "tmux new-session -d -s bot 'claude --model sonnet --dangerously-skip-permissions --dangerously-load-development-channels server:gptw-sales-bot'; sleep 5; tmux send-keys -t bot Enter; tail -f /dev/null"]
```

## 3. Crear `fly.toml` en la raíz del proyecto

```toml
app = "gptw-sales-bot"
primary_region = "iad"

[build]

[env]
  GPTW_BOT_PORT = "8787"
  CLAUDE_CODE_DISABLE_AUTOUPDATE = "1"

[http_service]
  internal_port = 8787
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[mounts]
  source = "claude_data"
  destination = "/root/.claude"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024
```

## 4. Crear app, volumen y secrets

```bash
fly auth login
fly apps create gptw-sales-bot
fly volumes create claude_data --region iad --size 1

fly secrets set \
  GPTW_ACCESS_TOKEN="..." \
  SALESFORCE_USERNAME="..." \
  SALESFORCE_PASSWORD="..." \
  SALESFORCE_TOKEN="..." \
  SALESFORCE_INSTANCE_URL="https://greatplacetoworkmexico.my.salesforce.com"
```

> Si el password tiene espacios o caracteres especiales, ponelo entre comillas dobles.

## 5. Deploy

```bash
fly deploy
```

## 6. Login de Claude Max (paso clave, una sola vez)

Cuando la app arranca por primera vez, Claude Code no tiene credenciales OAuth y va a pedir login. Hacés:

```bash
fly ssh console
tmux attach -t bot
```

Vas a ver el prompt de Claude. Escribí:

```
/login
```

- Se abre un link tipo `https://claude.ai/oauth/...`
- Pegalo en tu navegador → autorizá con tu cuenta Claude Max → copiá el código que aparece
- Pegalo de vuelta en la terminal del bot
- Salí del tmux **sin matarlo** con `Ctrl+B` luego `D`
- `exit` para cerrar la SSH

El login queda guardado en `/root/.claude/.credentials.json` dentro del volumen persistente. Si la machine se reinicia, sigue autenticado.

## 7. Verificar

```bash
fly status
curl https://gptw-sales-bot.fly.dev/health
# Debería responder 200 OK
```

Abrí `https://gptw-sales-bot.fly.dev/` en el navegador y probá una pregunta.

## Mantenimiento

- **Token OAuth de Claude Max expira ~cada 30 días** → repetir paso 6
- **Ver logs en vivo**: `fly logs`
- **Reiniciar machine**: `fly machine restart <id>` (obtené el id con `fly status`)
- **Redeploy tras cambio de código**: `git pull && fly deploy`

## Costo aproximado

- ~$5-10 USD/mes (1 vCPU compartida + 1 GB RAM + 1 GB volume)
- Más los $20 USD/mes del plan Claude Max

## Troubleshooting

**HTTP 502 al abrir la URL:**
- `fly logs` — ver si hay errores
- `fly ssh console` → `tmux attach -t bot` → ver si Claude Code está pidiendo login
- Si dice `API Error: 401 Invalid authentication credentials`, el OAuth expiró → repetir paso 6

**Bot responde con `Please run /login`:**
- OAuth expiró, repetir paso 6

**`bun: command not found` en SSH:**
- El binario está en `/usr/local/bin/bun` dentro del container, debería estar en PATH

**Querés cambiar de cuenta Claude Max:**
- `fly ssh console` → `rm /root/.claude/.credentials.json` → repetir paso 6
