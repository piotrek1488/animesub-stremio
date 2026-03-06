---
title: AnimeSub.info Stremio Addon
emoji: 📺
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# AnimeSub.info Stremio Addon

Wtyczka do Stremio pobierająca polskie napisy do anime z serwisu animesub.info.

## Funkcje

- 🔍 Automatyczne wyszukiwanie napisów na podstawie tytułu anime
- 📺 Obsługa seriali (z sezonami i odcinkami) oraz filmów
- 🇵🇱 Polskie napisy
- 🔄 Automatyczna konwersja ASS/SSA do SRT (Stremio nie obsługuje ASS)
- 💾 Cache wyników wyszukiwania
- 🔧 Automatyczne rozpakowywanie archiwów ZIP
- 🌐 Konwersja kodowania do UTF-8

## Szybki start (lokalnie)

```bash
npm install
npm start
```

Serwer wystartuje na `http://localhost:7000`. W Stremio dodaj addon: `http://localhost:7000/manifest.json`

---

## 🚀 Deploy na Hugging Face Spaces (REKOMENDOWANE - darmowe)

### Krok 1: Utwórz konto i Space

1. Zarejestruj się na [huggingface.co](https://huggingface.co/)
2. Idź do [huggingface.co/new-space](https://huggingface.co/new-space)
3. Wypełnij:
   - **Space name:** `stremio-animesub` (lub inna nazwa)
   - **License:** MIT
   - **SDK:** Docker
   - **Hardware:** CPU basic (darmowy)
4. Kliknij **Create Space**

### Krok 2: Dodaj pliki

W swoim nowym Space, kliknij "Files" → "Add file" → "Upload files" i wgraj wszystkie pliki z tego projektu:
- `index.js`
- `package.json`
- `package-lock.json`
- `Dockerfile`

Lub użyj Git:
```bash
git clone https://huggingface.co/spaces/TWOJA_NAZWA/stremio-animesub
cd stremio-animesub
# skopiuj pliki projektu
git add .
git commit -m "Initial commit"
git push
```

### Krok 3: Poczekaj na build

Hugging Face automatycznie zbuduje i uruchomi addon. Zajmie to 2-5 minut.

### Krok 4: Zainstaluj w Stremio

Twój addon będzie dostępny pod adresem:
```
https://TWOJA_NAZWA-stremio-animesub.hf.space/manifest.json
```

1. Otwórz Stremio
2. Idź do **Addons** → **Community Addons**
3. Wklej powyższy URL i kliknij **Install**

---

## Inne opcje hostingu

### Beamup (oficjalny hosting Stremio)

```bash
npm install -g beamup-cli
beamup
```

### Railway / Render / Fly.io

Wystarczy połączyć repo GitHub - platformy automatycznie wykryją Node.js.

Ustaw zmienną środowiskową:
- `BASE_URL` = publiczny URL Twojej aplikacji (np. `https://my-addon.railway.app`)

---

## Zmienne środowiskowe

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `PORT` | `7000` | Port serwera (HF wymaga 7860) |
| `BASE_URL` | auto | Publiczny URL (auto-wykrywany na HF) |

---

## Jak to działa

1. Stremio wysyła zapytanie o napisy z ID (np. `tt1234567:1:5`)
2. Addon pobiera tytuł anime z Cinemeta
3. Wyszukuje napisy na animesub.info
4. Filtruje po numerze odcinka/sezonu
5. Konwertuje ASS → SRT (jeśli potrzeba)
6. Zwraca napisy do Stremio

## Licencja

MIT
