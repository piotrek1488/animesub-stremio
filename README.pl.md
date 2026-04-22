## 🌍 Język
- 🇬🇧 [English](README.md)
- 🇵🇱 Polski

# AnimeSub.info – Stremio Addon

Addon do Stremio pobierający polskie napisy do anime z [animesub.info](http://animesub.info).

Przepisany na Python z [addonu JS](https://huggingface.co/spaces/anemicpathbling/stremio-animesub) i sklonowanego na [GitHub](https://github.com/piotrek1488/animesub-stremio) korzystającego ze Stremio Addon SDK (Node.js).

## Jak to działa

1. Stremio wysyła ID filmu/serialu (IMDB lub Kitsu)
2. Addon odpytuje Cinemeta (lub Kitsu API) żeby uzyskać tytuł anime — bez klucza API
3. Szuka tytułu na animesub.info z kilkoma strategiami (tytuł + odcinek, sam tytuł, po angielsku i po oryginalnym)
4. Filtruje wyniki — odrzuca inne serie (np. Boruto gdy szukamy Naruto), openingi, endingi i spin-offy
5. Gdy użytkownik wybierze napisy, addon pobiera ZIP dwuetapowo (sesja + świeży hash), rozpakowuje, konwertuje ASS→SRT i serwuje plik

## Struktura projektu

```
├── main.py            # Cały addon (FastAPI)
├── ASicon.jpg         # Ikona addonu
├── requirements.txt   # Zależności Python
├── deploy.sh          # Skrypt pierwszego deployu na Oracle Cloud
├── restart.sh         # Restart po aktualizacji kodu
├── render.yaml        # Konfiguracja dla Render (alternatywa)
├── README.md
└── README.pl.md
```

## Szybki start (lokalnie)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

Addon wystartuje na `http://localhost:8080/manifest.json`.

## Deploy na Oracle Cloud (zalecany, darmowy 24/7)

### Wymagania
- Konto Oracle Cloud ([rejestracja](https://cloud.oracle.com/sign-up), wymaga karty do weryfikacji)
- Instancja VM.Standard.E2.1.Micro (Always Free) lub VM.Standard.A1.Flex (ARM, Always Free)
- Darmowa subdomena z [DuckDNS](https://www.duckdns.org) (potrzebna do HTTPS)

### Przygotowanie Oracle Cloud

1. Stwórz instancję VM z Ubuntu 22.04/24.04, pobierz klucz SSH
2. W Security List (Networking → VCN → Public Subnet → Default Security List) dodaj reguły Ingress dla portów **80**, **443** i **8080** (Source CIDR: `0.0.0.0/0`, TCP)
3. Na DuckDNS stwórz subdomenę i wpisz publiczne IP serwera

### Instalacja

```bash
ssh -i klucz.key ubuntu@TWOJE_IP
sudo apt install -y sudo apt install -y python3 python3-pip python3-venv git
git clone https://github.com/piotrek1488/animesub-stremio.git ~/projects/animesub-stremio
cd ~/projects/animesub-stremio
```
lub
```bash
ssh -i klucz.key ubuntu@TWOJE_IP
sudo apt install -y sudo apt install -y python3 python3-pip python3-venv git gh
gh auth login
gh repo clone piotrek1488/animesub-stremio ~/projects/animesub-stremio
cd ~/projects/animesub-stremio
```

Otwórz `deploy.sh`, sprawdź zmienne na górze (domena, port, ścieżki), potem:

```bash
chmod +x deploy.sh restart.sh
./deploy.sh
```

Skrypt automatycznie zainstaluje Python, zależności, skonfiguruje systemd, Caddy (HTTPS), firewall i cron joba zapobiegającego wyłączeniu VM.

Na końcu dostaniesz link do wklejenia w Stremio:
```
https://twoja-subdomena.duckdns.org/manifest.json
```

### Aktualizacja kodu

```bash
cd ~/projects/animesub-stremio
git fetch origin
git rebase origin/main
./restart.sh
```

### Po co Pay As You Go?

Po rejestracji w Oracle od razu przejdź na Pay As You Go (Billing → Upgrade). Nadal korzystasz z darmowych zasobów (rachunek = 0 zł), ale Oracle nie zamknie konta za nieaktywność. Bez tego mogą wyłączyć instancję po 30 dniach bezczynności.

## Deploy alternatywny

### Koyeb (darmowy, nie usypia)
Deploy z GitHuba, darmowy plan obejmuje jedną usługę. Ustaw zmienną `BASE_URL` na URL deploymentu.

### Hugging Face Spaces (darmowy, usypia)
Działa, ale usypia po czasie bezczynności. Można obejść pingując UptimeRobotem. Addon auto-wykrywa zmienne `SPACE_HOST`/`SPACE_ID`.

### Render
Plik `render.yaml` jest gotowy. Darmowy plan usypia po 15 min. Ustaw zmienną `BASE_URL`.

## Zmienne środowiskowe

| Zmienna    | Wymagana | Opis |
|------------|----------|------|
| `BASE_URL` | Tak*     | Pełny URL deploymentu (z https://). Auto-wykrywany na HF Spaces i lokalnie. |
| `PORT`     | Nie      | Port serwera (domyślnie 8080) |

## Przydatne komendy (Oracle Cloud)

```bash
sudo systemctl status animesub      # status usługi
sudo systemctl restart animesub     # restart
sudo journalctl -u animesub -f      # logi na żywo
sudo systemctl status caddy         # status Caddy (HTTPS)
```

## Szczegóły techniczne

**Kodowanie strony** — animesub.info używa ISO-8859-2. Addon dekoduje poprawnie i serwuje napisy w UTF-8.

**System zabezpieczeń** — animesub.info wiąże hash pobierania z sesją. Addon najpierw wchodzi na stronę wyszukiwania (łapie ciasteczka + świeży hash), potem pobiera plik z tą samą sesją.

**Konwersja ASS→SRT** — Stremio nie obsługuje ASS/SSA, więc addon konwertuje po stronie serwera.

**Filtrowanie wyników** — addon sprawdza czy tytuł napisu odpowiada szukanemu anime i odrzuca inne serie (np. Shippuuden gdy szukasz Naruto), openingi, endingi i spin-offy.

**Stremio URL format** — Stremio dodaje do URL nazwę pliku (`/subtitles/series/tt123:1:1/filename=....json`). Addon obsługuje oba formaty.

**Cache** — wyniki wyszukiwania trzymane w pamięci przez 30 minut.

## Informacja o AI

Ten addon powstał przy wsparciu narzędzi AI.

AI było wykorzystywane do generowania kodu, refaktoryzacji oraz implementacji części funkcjonalności.  
Ostateczna logika, struktura oraz testy zostały zweryfikowane i poprawione ręcznie.
