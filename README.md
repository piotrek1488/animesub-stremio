## 🌍 Language
- 🇬🇧 English (default)
- 🇵🇱 [Polski](README.pl.md)

# AnimeSub.info – Stremio Addon

A Stremio addon that fetches Polish subtitles for anime from [animesub.info](http://animesub.info).

Rewritten in Python from a [JS addon](https://huggingface.co/spaces/anemicpathbling/stremio-animesub) and cloned on [GitHub](https://github.com/piotrek1488/animesub-stremio), using the Stremio Addon SDK (Node.js).

## How it works

1. Stremio sends a movie/series ID (IMDB or Kitsu)
2. The addon queries Cinemeta (or the Kitsu API) to retrieve the anime title — no API key required
3. It searches for the title on animesub.info using several strategies (title + episode, title only, English and original titles)
4. It filters results — removes other series (e.g. Boruto when searching for Naruto), openings, endings, and spin-offs
5. When the user selects subtitles, the addon downloads a ZIP in two steps (session + fresh hash), extracts it, converts ASS → SRT, and serves the file

## Project structure

```
├── main.py            # Entire addon (FastAPI)
├── ASicon.jpg         # Addon icon
├── requirements.txt   # Python dependencies
├── deploy.sh          # Initial deployment script for Oracle Cloud
├── restart.sh         # Restart after updating the code
├── render.yaml        # Configuration for Render (alternative)
├── README.md
└── README.pl.md
```

## Quick start (local)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

The addon will start at `http://localhost:8080/manifest.json`.

## Deployment on Oracle Cloud (recommended, free 24/7)

### Wymagania
- Oracle Cloud account ([sign up](https://cloud.oracle.com/sign-up), requires a card for verification)
- VM instance: VM.Standard.E2.1.Micro (Always Free) or VM.Standard.A1.Flex (ARM, Always Free)
- Free subdomain from [DuckDNS](https://www.duckdns.org) (required for HTTPS)

### Preparing Oracle Cloud

1. Create a VM instance with Ubuntu 22.04/24.04 and download the SSH key
2. In Security List (Networking → VCN → Public Subnet → Default Security List), add Ingress rules for ports 80, 443, and 8080 (Source CIDR: 0.0.0.0/0, TCP)
3. Create a subdomain on DuckDNS and point it to your server’s public IP

### Installation

```bash
ssh -i id_rsa.key ubuntu@YOUR_IP
sudo apt install -y sudo apt install -y python3 python3-pip python3-venv git
git clone https://github.com/piotrek1488/animesub-stremio.git ~/projects/animesub-stremio
cd ~/projects/animesub-stremio
```
or
```bash
ssh -i id_rsa.key ubuntu@YOUR_IP
sudo apt install -y sudo apt install -y python3 python3-pip python3-venv git gh
gh auth login
gh repo clone piotrek1488/animesub-stremio ~/projects/animesub-stremio
cd ~/projects/animesub-stremio
```

Open `deploy.sh`, check the variables at the top (domain, port, paths), then:

```bash
chmod +x deploy.sh restart.sh
./deploy.sh
```

The script will automatically install Python, dependencies, configure systemd, Caddy (HTTPS), firewall, and a cron job to prevent the VM from shutting down.

At the end, you’ll get a link to paste into Stremio:
```
https://your-subdomain.duckdns.org/manifest.json
```

### Updating the code

```bash
cd ~/projects/animesub-stremio
git fetch origin
git rebase origin/main
./restart.sh
```

### Why Pay As You Go?

After registering with Oracle, switch to Pay As You Go (Billing → Upgrade). You still use free resources (bill = $0), but Oracle won’t suspend your account due to inactivity. Without this, your instance may be stopped after 30 days of inactivity.

## Alternative deployment

### Koyeb (free, no sleeping)
Deploy from GitHub. The free plan includes one service. Set the `BASE_URL` variable to your deployment URL.

### Hugging Face Spaces (free, sleeps)
Works, but goes to sleep after inactivity. This can be bypassed by pinging it with UptimeRobot. The addon auto-detects `SPACE_HOST`/`SPACE_ID` variables.

### Render
The `render.yaml` file is ready. The free plan sleeps after 15 minutes. Set the `BASE_URL` variable.

## Environment variables

| Variable   | Required | Description |
|------------|----------|-------------|
| `BASE_URL` | Yes*     | Full deployment URL (with https://). Auto-detected on HF Spaces and locally |
| `PORT`     | No       | Server port (default: 8080) |

## Useful commands (Oracle Cloud)

```bash
sudo systemctl status animesub      # service status
sudo systemctl restart animesub     # restart
sudo journalctl -u animesub -f      # live logs
sudo systemctl status caddy         # Caddy (HTTPS) status
```

## Technical details

**Page encoding** — animesub.info uses ISO-8859-2. The addon decodes it correctly and serves subtitles in UTF-8.

**Security system** — animesub.info binds the download hash to a session. The addon first opens the search page (gets cookies + fresh hash), then downloads the file within the same session.

**ASS → SRT conversion** — Stremio does not support ASS/SSA, so the addon converts it on the server side.

**Result filtering** — the addon checks whether the subtitle title matches the requested anime and removes other series (e.g. Shippuuden when searching for Naruto), openings, endings, and spin-offs.

**Stremio URL format** — Stremio adds a filename to the URL (`/subtitles/series/tt123:1:1/filename=....json`). The addon supports both formats.

**Cache** — search results are stored in memory for 30 minutes.

## AI Notice

This addon was developed with the assistance of AI tools.

AI was used to help with code generation, refactoring, and implementation details.  
The final logic, structure, and testing were verified and adjusted manually.
