# Deploying on the on-premise Linux server

Your colleague has already installed MongoDB. These steps put the app beside it,
in its own database, with its own user. Hospital LAN only — nothing here reaches
the internet.

Everything below assumes a Debian/Ubuntu server reached over VS Code Remote-SSH.
Run the commands as a user with sudo.

---

## 1. Give the app its own database and user

Do **not** let the app share the admin credentials of the existing `mongod`. It
needs `readWrite` on one database and nothing else, so a mistake here cannot
touch any other system on that server.

```bash
mongosh
```

```javascript
use rtt
db.createUser({
  user: "rtt_app",
  pwd:  "<a long random password>",
  roles: [ { role: "readWrite", db: "rtt" } ]
})
```

Check that `mongod` is bound to localhost only — this app never needs Mongo
exposed on the network:

```bash
grep -A3 'net:' /etc/mongod.conf     # bindIp should be 127.0.0.1
```

Storage is tiny: roughly **35 MB a year**, including run history and indexes.

---

## 2. Create the service account and directories

```bash
sudo useradd --system --home /opt/rtt --shell /usr/sbin/nologin rtt
sudo mkdir -p /opt/rtt /var/lib/rtt/uploads /var/lib/rtt/exports
sudo chown -R rtt:rtt /opt/rtt /var/lib/rtt
```

`/var/lib/rtt/uploads` keeps every raw workbook that is imported. Do not prune
it: it is what makes an import bug replayable months later.

---

## 3. Install the backend

```bash
sudo -u rtt git clone <this repo> /opt/rtt/src
sudo -u rtt cp -r /opt/rtt/src/backend /opt/rtt/backend
cd /opt/rtt/backend

sudo -u rtt python3 -m venv .venv
sudo -u rtt .venv/bin/pip install -r requirements.txt

sudo -u rtt cp .env.example .env
sudo -u rtt nano .env
```

Fill in `.env`:

```ini
MONGO_URI=mongodb://rtt_app:<the password>@127.0.0.1:27017/rtt?authSource=rtt
MONGO_DB=rtt
JWT_SECRET=<paste the output of the command below>
CORS_ORIGINS=http://rtt.local
COOKIE_SECURE=false
UPLOAD_DIR=/var/lib/rtt/uploads
```

Generate the secret — never reuse the example value:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

`chmod 600 .env`, because it holds the database password.

---

## 4. Load the starting data

```bash
cd /opt/rtt/backend
sudo -u rtt .venv/bin/python -m scripts.seed
```

This creates the 13 people, the cycles and their runs — the same data the demo
runs on, so the app behaves identically once the frontend is switched over.

**Every seeded account has the password `amrita`.** Change them before anyone
uses the system for real: sign in as `ranga.n`, open **People**, and reset each
one. The seed refuses to run twice unless you pass `--reset`, which drops
everything — never use `--reset` once real testing data is in there.

If you would rather start empty, skip the seed and create the first admin by
hand:

```bash
sudo -u rtt .venv/bin/python - <<'PY'
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import get_settings
from app.security import hash_password

async def main():
    s = get_settings()
    db = AsyncIOMotorClient(s.mongo_uri)[s.mongo_db]
    await db.users.insert_one({
        "username": "ranga.n", "full_name": "Ranganadhan Nadadhur",
        "email": "ranga.n@amrita.org", "role": "admin",
        "aliases": ["Ranga", "Ranganadhan"],
        "password_hash": hash_password("<a real password>"),
        "is_active": True, "last_seen_at": None,
    })
    print("admin created")
asyncio.run(main())
PY
```

---

## 5. Run the API as a service

```bash
sudo cp /opt/rtt/src/deploy/rtt-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rtt-api
systemctl status rtt-api
curl -s localhost:8000/api/health
```

`/api/health` returns `{"status":"ok","database":"rtt"}` when Mongo is reachable,
and `503` when it is not — point any monitoring you have at that URL.

---

## 6. Build and serve the frontend

The frontend is a static bundle. Build it on any machine with Node 20+ and copy
the output across, or build on the server itself.

```bash
cd /opt/rtt/src/frontend
npm ci
printf 'VITE_USE_MOCK=false\nVITE_API_BASE=/api\n' > .env.production
npm run build
sudo cp -r dist/* /opt/rtt/frontend/
sudo chown -R rtt:rtt /opt/rtt/frontend
```

`VITE_USE_MOCK=false` is the whole switch from the demo to the real backend.
Nothing else in the app changes.

```bash
sudo apt install nginx
sudo cp /opt/rtt/src/deploy/nginx-rtt.conf /etc/nginx/sites-available/rtt
sudo ln -sf /etc/nginx/sites-available/rtt /etc/nginx/sites-enabled/rtt
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Set `server_name` in that file to the server's LAN hostname or IP.

---

## 7. If you put it behind HTTPS

The refresh token is an httpOnly cookie. If the site is served over HTTPS, set
`COOKIE_SECURE=true` in `.env` and restart the service. Leave it `false` on plain
HTTP — a browser silently drops a `Secure` cookie over HTTP, and people will be
signed out every thirty minutes with no explanation.

---

## 8. Backups

One command, run nightly from cron:

```bash
mongodump --uri="mongodb://rtt_app:<password>@127.0.0.1:27017/rtt?authSource=rtt" \
          --out=/var/backups/rtt/$(date +%F)
```

Also back up `/var/lib/rtt/uploads` — the database can be rebuilt from those
workbooks, but the workbooks cannot be rebuilt from anything.

Restore:

```bash
mongorestore --uri="..." --drop /var/backups/rtt/2026-08-16/rtt
```

---

## 9. Upgrading later

```bash
cd /opt/rtt/src && sudo -u rtt git pull
sudo -u rtt cp -r backend/* /opt/rtt/backend/
cd /opt/rtt/backend && sudo -u rtt .venv/bin/pip install -r requirements.txt
sudo systemctl restart rtt-api
```

Indexes are created on startup and the operation is idempotent, so there is no
separate migration step.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` returns 503 | Mongo unreachable or wrong credentials | `systemctl status mongod`, then re-check `MONGO_URI` |
| Everyone signed out after 30 minutes | `COOKIE_SECURE=true` on plain HTTP | Set it to `false`, restart |
| Login works, every other call 401 | Clock skew between server and client | `timedatectl set-ntp true` |
| Refresh on `/all-items` gives 404 | nginx missing the `try_files` fallback | Use the supplied config |
| Import rejects a real sheet | The sheet has no testing status or remark column | Pick the right sheet in step 2 of the wizard |
| Upload fails on a large workbook | nginx `client_max_body_size` | Already 25m in the supplied config |
