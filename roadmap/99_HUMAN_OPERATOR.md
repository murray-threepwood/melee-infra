# Roadmap para el humano (operador CEO)

Este documento es la única lista de cosas que **tenés que hacer vos**. No hay que decidir arquitectura: cada paso dice qué clickear, qué copiar y cómo saber que está bien.

Hacelo **en orden**. Si un paso ya lo cumpliste, marcá el checkbox y seguí.

Cuando termines un bloque, volvé al repo y ejecutá:

```bash
docker compose up -d
bash tests/test_e2e_stack.sh
```

---

## 0. Estado que deja el agente

El agente ya crea (o va a crear) esto en el repo:

- Carpetas `config/`, `workflows/`, `tests/`, `workspace/`
- `.env.example` (plantilla) y un `.env` **con placeholders**, no con secretos reales
- `docker-compose.yml` con los 5 servicios
- Workflows n8n en `workflows/`
- Tests en `tests/`
- `RUNBOOK.md` para incidentes
- Shim HTTP `config/workspace-mcp/server.mjs` (Gmail draft-only, **nunca send**). El paquete npm del roadmap original no existe.

Lo que **no** puede hacer el agente: cuentas externas, OAuth en el browser, tokens reales.

Hasta que completes H3, `cloudflared` corre pero loguea `Failed to get tunnel`. Eso es esperado.

---

## Checklist maestro

- [x] **H1.** Generar claves locales (Postgres + n8n) y pegarlas en `.env`
- [x] **H2.** Dominio en Cloudflare
- [x] **H3.** Túnel Zero Trust + token en `.env`
- [x] **H4.** Hostname público apuntando a n8n (`http://n8n:5678`)
- [x] **H5.** Bot de Telegram + token en `.env`
- [x] **H6.** `TELEGRAM_CHAT_ID` en `.env`
- [x] **H7.** API key de DeepSeek en `.env`
- [ ] **H8.** Proyecto Google Cloud + OAuth (Gmail draft-only)
- [ ] **H9.** Copiar `config/mcp-auth/.gauth.json.example` → `.gauth.json` y completar
- [x] **H10.** Reiniciar el stack y crear el usuario dueño de n8n
- [x] **H11.** Importar workflows y credencial de Telegram en n8n
- [ ] **H12.** Probar el bot (mensaje → botones HITL)

---

## H1. Claves locales (5 minutos)

1. Abrí Terminal.
2. Entrá al repo:

```bash
cd /Users/hbauzan/treepwood/MURRAY/murray-infra
```

3. Si no existe `.env`:

```bash
cp .env.example .env
```

4. Generá tres valores (copiá cada salida):

```bash
openssl rand -hex 32
openssl rand -base64 24
openssl rand -hex 16
```

5. Abrí `.env` y reemplazá **solo** estas tres líneas (dejá el resto para los pasos siguientes):

| Variable | Pegá |
| :--- | :--- |
| `N8N_ENCRYPTION_KEY` | la salida de `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | la salida de `openssl rand -base64 24` |
| `POSTGRES_USER` / `POSTGRES_DB` | dejá `n8n_admin` y `n8n_database` salvo que quieras otros nombres |

6. **Verificación**: en `.env` esas tres variables ya no dicen `CAMBIAR_POR` ni `clave_aleatoria`.

> Si cambiás `POSTGRES_PASSWORD` **después** de haber levantado Postgres una vez, la base ya nació con la clave vieja. En ese caso: `docker compose down -v` (borra el volumen de Postgres) y volvé a `docker compose up -d`.

---

## H2. Dominio en Cloudflare (una sola vez)

Necesitás un dominio cuya DNS la maneje Cloudflare. Sin eso el túnel no publica n8n.

1. Entrá a [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) (o login si ya tenés cuenta).
2. En el dashboard: **Add a domain** / **Add site**.
3. Escribí tu dominio (ejemplo: `midominio.com`) → **Continue**.
4. Plan: **Free** → **Continue**.
5. Cloudflare te muestra 2 nameservers. Copialos.
6. En el registrador donde compraste el dominio (Namecheap, Google Domains, nic.ar, etc.) pegá esos nameservers.
7. Volvé a Cloudflare y esperá a que el dominio figure **Active**. Puede tardar de minutos a 24 h.

**Verificación**: en Cloudflare el dominio aparece con estado Active (no “Pending Nameservers”).

Si **ya** tenés el dominio en Cloudflare y está Active: salteá H2.

---

## H3. Crear el túnel y copiar el token

El contenedor `cloudflared` del compose **no abre puertos**. Solo corre con un token.

1. Entrá a [https://one.dash.cloudflare.com/](https://one.dash.cloudflare.com/) (Zero Trust). Si pide habilitar Zero Trust, aceptá el plan **Free**.
2. Menú: **Networking** → **Tunnels**.
3. **Create a tunnel**.
4. Tipo: **Cloudflared**.
5. Nombre: `murray-n8n`.
6. **Save tunnel** / **Create Tunnel**.
7. En la pantalla de instalación **no ejecutes** el comando en tu Mac. Abrilo en un editor de texto.
8. El comando se ve así:

```text
sudo cloudflared service install eyJ...un-bloquecito-largo...
```

9. Copiá **solo** la parte que empieza con `eyJ` (todo el token, una sola línea, sin espacios).
10. Pegala en `.env`:

```bash
CLOUDFLARE_TUNNEL_TOKEN=eyJ...pegá-acá-el-token-completo...
```

**Verificación**: `.env` tiene `CLOUDFLARE_TUNNEL_TOKEN=` seguido de un string que empieza con `eyJ` y tiene más de 100 caracteres.

Si perdiste el token:

1. **Networking** → **Tunnels** → `murray-n8n`.
2. **Add a replica** / token.
3. Volvé a copiar el `eyJ...`.

---

## H4. Hostname público → n8n

El tráfico entra por Cloudflare y `cloudflared` lo manda al servicio Docker `n8n`.
**No uses `localhost`**. Dentro de la red Docker, n8n se llama `n8n`.

1. **Networking** → **Tunnels** → `murray-n8n`.
2. Pestaña **Routes** → **Add route** → **Published application**.
3. Completá:

| Campo | Valor exacto |
| :--- | :--- |
| Subdomain | `ceo` (o el que quieras; un solo nivel) |
| Domain | tu dominio de H2 (ej. `midominio.com`) |
| Service URL | `http://n8n:5678` |

4. **Add route**.
5. En `.env` poné el hostname completo, **sin** `https://`:

```bash
SUBDOMINIO_PUBLICO=ceo.midominio.com
```

(reemplazá por el subdomain + domain que elegiste)

6. Guardá `.env`.

**Verificación** (después de H10, cuando el stack esté arriba):

```bash
curl -I https://ceo.midominio.com/healthz
```

Esperado: HTTP 200 (o 204). Si da timeout, el túnel no está Healthy o el Service URL no es `http://n8n:5678`.

---

## H5. Bot de Telegram

1. Abrí Telegram (app o [https://web.telegram.org/](https://web.telegram.org/)).
2. Buscá `@BotFather` (el oficial, con tilde azul).
3. Mandale:

```text
/newbot
```

4. Nombre visible: `Murray CEO` (o el que quieras).
5. Username: tiene que terminar en `bot`, ej. `murray_ceo_bot`.
6. BotFather te responde un token con forma `123456789:AAH...`.
7. Copiá el token completo.
8. Pegalo en `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456789:AAH...pegá-el-token-completo...
```

**Verificación**:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

(reemplazá `${TELEGRAM_BOT_TOKEN}` por el valor, o `source .env` antes). Esperado: `"ok":true` y el username del bot.

---

## H6. Tu Chat ID (filtro HITL)

El bot ignora a cualquiera que no sea este ID. Tiene que ser **el tuyo**.

1. En Telegram, buscá tu bot y mandale cualquier mensaje: `hola`.
2. En Terminal (con el token ya en `.env`):

```bash
cd /Users/hbauzan/treepwood/MURRAY/murray-infra
set -a && source .env && set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
```

3. En el JSON buscá `"chat":{"id":` y un número (puede ser negativo si es grupo; para chat privado es positivo, ej. `987654321`).
4. Pegalo en `.env` **sin comillas**:

```bash
TELEGRAM_CHAT_ID=987654321
```

Si `getUpdates` devuelve `"result":[]`:

1. Mandale otro mensaje al bot.
2. Repetí el `curl`.

**Verificación**: `TELEGRAM_CHAT_ID` en `.env` es solo dígitos (o dígitos con un `-` adelante).

---

## H7. DeepSeek (OpenHands)

1. Entrá a [https://platform.deepseek.com/](https://platform.deepseek.com/).
2. Creá cuenta o login.
3. **API Keys** → **Create API Key**.
4. Copiá la key (`sk-...`). Se muestra una sola vez.
5. Pegala en `.env`:

```bash
DEEPSEEK_API_KEY=sk-...pegá-acá...
```

**Verificación**: `.env` tiene `DEEPSEEK_API_KEY=` empezando con `sk-`.

Costo: DeepSeek cobra por token. No hace falta cargar mucho; unos dólares alcanzan para pruebas.

---

## H8. Google Cloud OAuth (Gmail solo borradores)

Objetivo: que el MCP pueda **leer** y **crear borradores**. El envío directo queda bloqueado en Docker (`GMAIL_ALLOW_SENDING=false`). En Google, no pidas el scope de send.

### H8.1 Proyecto

1. Entrá a [https://console.cloud.google.com/](https://console.cloud.google.com/).
2. Arriba: selector de proyecto → **New Project**.
3. Nombre: `murray-infra`.
4. **Create**. Esperá a que el selector muestre `murray-infra`.

### H8.2 APIs

1. Menú ☰ → **APIs & Services** → **Library** (o **APIs y servicios** → **Biblioteca**).
2. Buscá exactamente **`Gmail API`** → **Enable** / **Habilitar**.
3. Si la Library también lista **Gmail MCP API**: **no la habilites**. Ese producto de Google no es el MCP de este repo. El MCP nuestro es el contenedor Docker `workspace-mcp`.
4. Volvé a Library. Buscá **`Google Calendar API`** → **Enable**.

### H8.3 Pantalla de consentimiento (Google Auth Platform)

La consola ya no dice “OAuth consent screen → User type External”. Ahora es **Google Auth Platform** (a veces bajo **APIs y servicios** → **Pantalla de consentimiento de OAuth**, que redirige al wizard).

1. Entrá a [Google Auth Platform](https://console.cloud.google.com/auth/overview) con el proyecto `murray-infra` seleccionado arriba.
2. Si pide **Información de la app** / branding: nombre `Murray Infra`, correo de soporte = tu Gmail. **Siguiente**.
3. **Público** (Audience). Elegí **Usuarios externos** (External), no **Interno**.
   - **Usuarios externos**: Gmail personal, 1-Person CEO. La app queda en **modo prueba** y solo entran las cuentas que agregues como test users.
   - **Interno**: solo si tenés Google Workspace de una organización. Con Gmail `@gmail.com` no sirve.
4. **Siguiente**.
5. **Información de contacto**: tu mismo Gmail. Aceptá los términos si aparecen. **Crear** / **Finish**.
6. **No** mandes la app a producción ni al centro de verificación. Dejala en prueba.
7. Menú izquierdo → **Acceso a los datos** (Data access) → **Add or remove scopes** / agregar permisos. Agregá **solo**:

| Scope | Para qué |
| :--- | :--- |
| `https://www.googleapis.com/auth/gmail.readonly` | Leer correos |
| `https://www.googleapis.com/auth/gmail.compose` | Crear borradores (no send) |
| `https://www.googleapis.com/auth/calendar.readonly` | Leer calendar (opcional) |

Si no ves el path completo, buscá `gmail.readonly` y `gmail.compose`. **No** tildes `gmail.send` ni `gmail.modify`.

8. **Save**.
9. Menú → **Público** → **Usuarios de prueba** / Test users → **Add users** → tu misma dirección de Gmail → **Save**.

Esa **Verificación** de abajo **no es una pantalla de Google**. Es un checklist tuyo: mirá tres lugares del menú izquierdo y confirmá.

| Qué tiene que quedar | Dónde se ve en Google Auth Platform |
| :--- | :--- |
| Audience = Usuarios externos (modo **Prueba**). No pulses **Marcar como interno**. | **Público** |
| Un test user: tu Gmail (ej. el de `threepwood.uy` o `@gmail.com`) | **Público** → **Usuarios de prueba** |
| Scopes solo `gmail.readonly` + `gmail.compose` (+ calendar opcional). Sin `gmail.send` ni `gmail.modify`. | **Acceso a los datos** (no está en Público) |

### H8.4 Cliente OAuth (Web, para el Playground)

H8.5 usa [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/). Ese sitio redirige a `https://developers.google.com/oauthplayground`. Un cliente **Desktop** solo admite `http://localhost` → Google responde **`Error 400: redirect_uri_mismatch`**. Por eso acá el tipo es **Aplicación web**, no escritorio.

Si ya creaste un cliente Desktop: no lo borres. Creá **otro** cliente Web y pegá *esos* ID/secret en `.env`. El refresh token tiene que nacer del mismo cliente que queda en `.env`.

1. **Google Auth Platform** → **Clientes** → crear cliente → **OAuth client ID**.
2. Tipo: **Aplicación web** / **Web application**.
3. Nombre: `murray-mcp-playground`.
4. Hay **dos** listas. No las mezcles:
   - **Orígenes de JavaScript** / Authorized JavaScript origins: **dejalo vacío**. Si Google lo exige, solo `https://developers.google.com` (sin path). Si pegás `/oauthplayground` acá, dice *«Los URI no deben contener una ruta»*.
   - **URIs de redirección autorizados** / Authorized redirect URIs → **Add URI** (esta es la lista correcta):

```text
https://developers.google.com/oauthplayground
```

5. **Create**. Copiá **Client ID** y **Client secret**.
6. Pegá en `.env` (reemplazá los del Desktop si los habías puesto; no los mandes al chat ni a git):

```bash
GOOGLE_CLIENT_ID=.....apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

**Listo H8.4.** El `.gauth.json` de H9 usa estos mismos dos valores (los del Web).

### H8.5 Refresh token

Google no te da el `GOOGLE_REFRESH_TOKEN` al crear el cliente. Hay que loguearse **una vez** con el cliente Web de H8.4.

1. Entrá a [https://developers.google.com/oauthplayground/](https://developers.google.com/oauthplayground/).
2. Engranaje (arriba a la derecha):
   - Tildá **Use your own OAuth credentials**.
   - Pegá el Client ID y Client secret **del cliente Web** (los de `.env` ahora).
   - **Access type**: Offline (si no, no sale `refresh_token`).
3. Cerrá el engranaje.
4. Step 1: no alcanza con pegar un scope en el buscador de abajo. Agregá **los dos** (tienen que quedar listados/tildados, no solo en el recuadro):

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.compose
```

5. **Authorize APIs** → `murray@threepwood.uy` (test user de H8.3) → **Allow**.
6. Si ves `redirect_uri_mismatch`: el Playground está usando el cliente Desktop o le falta la URI de H8.4. Volvé a H8.4.
7. **Exchange authorization code for tokens**.
8. Copiá `refresh_token` (empieza con `1//`) a `.env`:

```bash
GOOGLE_REFRESH_TOKEN=1//...pegá-acá...
```

**Verificación**: las tres `GOOGLE_*` en `.env` son las del cliente **Web**. No las mandes al chat.

---

## H9. Archivo OAuth local del MCP

1. En el repo:

```bash
cd /Users/hbauzan/treepwood/MURRAY/murray-infra
cp config/mcp-auth/.gauth.json.example config/mcp-auth/.gauth.json
```

2. Abrí `config/mcp-auth/.gauth.json` y reemplazá (mismos valores del **cliente Web** de H8.4, no los del Desktop):

| Placeholder | Valor |
| :--- | :--- |
| `REEMPLAZAR_CON_GOOGLE_CLIENT_ID` | el mismo `GOOGLE_CLIENT_ID` de `.env` |
| `REEMPLAZAR_CON_GOOGLE_CLIENT_SECRET` | el mismo `GOOGLE_CLIENT_SECRET` de `.env` |

3. **No** commitees `.gauth.json`. Ya está en `.gitignore`.

**Verificación**:

```bash
test -f config/mcp-auth/.gauth.json && echo "GAUTH_OK"
```

---

## H10. Reiniciar el stack y entrar a n8n

Con `.env` completo:

```bash
cd /Users/hbauzan/treepwood/MURRAY/murray-infra
docker compose up -d
docker compose ps
```

Esperado: `postgres_db`, `n8n`, `openhands` en `running`. `cloudflared` Healthy en el dashboard de Cloudflare. `workspace-mcp` running (el `npm install` del primer arranque puede tardar 1–2 minutos).

1. En el browser: [http://127.0.0.1:5678](http://127.0.0.1:5678)
2. Primera vez: n8n pide crear el **owner**.
3. Email: el tuyo.
4. Password: una que recuerdes (no va en `.env`; es la UI).
5. Completá el setup. No hace falta conectar n8n Cloud.

**Verificación**: ves el canvas vacío o la home de n8n, no la pantalla de “Set up owner”.

---

## H11. Importar workflows y Telegram en n8n

### Credencial Telegram

1. En n8n: menú izquierdo → **Credentials** → **Add credential**.
2. Buscá **Telegram**.
3. Access Token: pegá el mismo `TELEGRAM_BOT_TOKEN` de `.env`.
4. Nombre de la credencial: `Telegram account` (tiene que coincidir con el JSON de los workflows).
5. **Save**.

### Importar los dos flujos

1. Menú → **Workflows** → **⋯** / **Import from File**.
2. Elegí `workflows/telegram_hitl_router.json`.
3. Abrí el nodo **Telegram Trigger** y **Enviar Teclado HITL** y **Notificar Resolución HITL**: asigná la credencial `Telegram account` si no quedó linkeada.
4. Arriba a la derecha: **Active** = ON.
5. Repetí import con `workflows/email_triage_draft.json`.
6. En ese flujo, asigná la misma credencial Telegram al nodo de notificación.
7. Dejá **Active** = ON cuando H8/H9 estén listos. Si Google todavía no está, dejalo OFF.

### Webhook de Telegram

Con el túnel de H4 vivo y `WEBHOOK_URL=https://${SUBDOMINIO_PUBLICO}/`, n8n registra el webhook al activar el trigger.

**Verificación**:

```bash
set -a && source .env && set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Esperado: `"url"` apuntando a `https://<SUBDOMINIO_PUBLICO>/webhook/...`. Si `url` está vacío, el workflow no está Active o el túnel no llega a n8n.

---

## H12. Prueba HITL (el “hola” del sistema)

1. En Telegram, abrí tu bot.
2. Mandá: `probar sandbox`.
3. Esperado: un mensaje con tres botones: **Aprobar**, **Rechazar**, **Pausar**.
4. Tocá **Rechazar**. Esperado: `✅ Orden procesada: REJECT_TASK:...`.
5. Si mandás el mismo texto desde **otra** cuenta de Telegram: **silencio total**. El filtro de `TELEGRAM_CHAT_ID` funciona.

Si no llega nada:

1. `docker compose logs --since "$(docker inspect -f '{{.State.StartedAt}}' murray-n8n)" n8n` (un `--tail=50` puede mostrar un 405 fósil de *antes* del último restart)
2. `docker compose logs --tail=50 cloudflared`
3. Repetí `getWebhookInfo` de H11.
4. `bash tests/test_live_hitl_dispatch.sh` tiene que decir `LIVE_HITL_DISPATCH_OK` (nodo `¿Aprobar OpenHands?` en el publicado).

OpenHands (botón **Aprobar**) solo tiene sentido con H7 completo y el servicio `openhands` healthy. Si OpenHands no responde, el nodo HTTP puede fallar; el resto del HITL igual tiene que mostrar los botones.

---

## Orden si volvés otro día

Hacé solo el próximo checkbox vacío del **Checklist maestro**. No saltees H1 (si Postgres ya levantó con password placeholder, o cambiás la clave y rompés el volumen, o dejás el placeholder y listo).

Cuando H1–H12 estén tildados:

```bash
bash tests/test_e2e_stack.sh
```

Esperado: `E2E_VERIFICACION_COMPLETA_OK`.

---

## Qué no toques

- No pongas `GMAIL_ALLOW_SENDING=true`.
- No mapees puertos de Postgres al `0.0.0.0`.
- No commitees `.env`, `.gauth.json` ni tokens.
- No cambies `N8N_ENCRYPTION_KEY` una vez que n8n ya guardó credenciales.
