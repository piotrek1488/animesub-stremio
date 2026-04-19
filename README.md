# AnimeSub.info – Stremio Addon

Addon do Stremio pobierający polskie napisy do anime z [animesub.info](http://animesub.info).

Przepisany na Python/FastAPI na podstawie działającego addonu JS. Obsługuje zarówno IMDB jak i Kitsu ID, automatycznie konwertuje napisy ASS/SSA do formatu SRT (Stremio nie obsługuje ASS), i radzi sobie z systemem zabezpieczeń animesub.info (hash powiązany z sesją).

## Jak to działa

1. Stremio wysyła ID filmu/serialu (IMDB lub Kitsu)
2. Addon odpytuje Cinemeta (lub Kitsu API) żeby uzyskać tytuł anime
3. Szuka tytułu na animesub.info (`szukaj.php`) z kilkoma strategiami (tytuł + odcinek, sam tytuł, po angielsku i po oryginalnym)
4. Zwraca listę napisów do Stremio
5. Gdy użytkownik wybierze napisy, addon pobiera ZIP z animesub.info (dwuetapowo — najpierw sesja + świeży hash, potem pobranie), rozpakowuje, konwertuje ASS→SRT jeśli trzeba, i serwuje plik

## Wymagania

- Python 3.10+
- Pakiety z `requirements.txt`

## Uruchomienie lokalne

```bash
pip install -r requirements.txt
python main.py
```

Addon wystartuje na `http://localhost:8080`. Link do instalacji w Stremio:

```
http://localhost:8080/manifest.json
```

## Deploy na Render

1. Stwórz nowy Web Service na [render.com](https://render.com)
2. Połącz z repozytorium
3. Ustaw zmienną środowiskową `BASE_URL` na pełny URL deploymentu, np. `https://animesub-addon.onrender.com`
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Plik `render.yaml` jest już skonfigurowany — Render powinien go wykryć automatycznie.

## Deploy na Hugging Face Spaces

Addon automatycznie wykrywa zmienne `SPACE_HOST` / `SPACE_ID` i ustawia `BASE_URL` sam. Wystarczy wrzucić pliki do Space z runtime Python.

## Zmienne środowiskowe

| Zmienna    | Wymagana | Opis                                                        |
|------------|----------|-------------------------------------------------------------|
| `BASE_URL` | Tak*     | Pełny URL deploymentu. Auto-wykrywany na HF Spaces i lokalnie. |
| `PORT`     | Nie      | Port serwera (domyślnie 8080)                               |

*Na HF Spaces i lokalnie ustawia się sam.

## Instalacja w Stremio

1. Otwórz Stremio
2. Przejdź do Addons → Community Addons
3. Wklej URL manifestu w pole "Addon Repository URL":
   ```
   https://twoj-addon.onrender.com/manifest.json
   ```

## Endpointy

| Ścieżka                                    | Opis                              |
|---------------------------------------------|-----------------------------------|
| `/manifest.json`                            | Manifest addonu                   |
| `/subtitles/{type}/{id}.json`               | Wyszukiwanie napisów (Stremio API)|
| `/subtitles/download?id=...&hash=...&...`   | Proxy pobierania napisów          |

## Szczegóły techniczne

**Kodowanie strony** — animesub.info używa ISO-8859-2, nie UTF-8. Addon dekoduje odpowiedzi poprawnie i serwuje napisy w UTF-8.

**System zabezpieczeń** — animesub.info wiąże hash pobierania z sesją (ciasteczkami). Addon obsługuje to dwuetapowo: najpierw wchodzi na stronę wyszukiwania żeby złapać ciasteczka i świeży hash, a dopiero potem pobiera plik z tą samą sesją.

**Konwersja ASS→SRT** — Stremio nie obsługuje formatu ASS/SSA, więc addon konwertuje je na SRT po stronie serwera (parsuje sekcję `[Events]`, konwertuje format czasu, usuwa tagi ASS).

**Strategie wyszukiwania** — addon próbuje kilku wariantów zapytania (tytuł + sezon + odcinek, tytuł + odcinek, sam tytuł) i przerywa gdy znajdzie dokładne dopasowanie.

**Cache** — wyniki wyszukiwania są cachowane w pamięci na 30 minut.

## Struktura projektu

```
├── main.py            # Cały addon (FastAPI)
├── requirements.txt   # Zależności Python
├── render.yaml        # Konfiguracja deploymentu na Render
└── README.md
```

## Na podstawie

Przepisany na Python z [addonu JS](https://huggingface.co/spaces/anemicpathbling/stremio-animesub) i sklonowanego na [GitHub](https://github.com/piotrek1488/animesub-stremio) korzystającego ze Stremio Addon SDK (Node.js).
