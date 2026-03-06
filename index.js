const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const AdmZip = require('adm-zip');

// Zmienna globalna dla BASE_URL - ustawiana przy starcie serwera
let BASE_URL_RESOLVED = '';

/**
 * Konwertuje czas ASS (H:MM:SS.cc) na format SRT (HH:MM:SS,mmm)
 */
function assTimeToSrt(assTime) {
    // ASS format: H:MM:SS.cc (centisekundy)
    const match = assTime.match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
    if (!match) return '00:00:00,000';
    
    const hours = match[1].padStart(2, '0');
    const minutes = match[2];
    const seconds = match[3];
    const centis = match[4];
    const millis = (parseInt(centis, 10) * 10).toString().padStart(3, '0');
    
    return `${hours}:${minutes}:${seconds},${millis}`;
}

/**
 * Usuwa tagi ASS z tekstu (np. {\i1}, {\b1}, {\pos(x,y)}, itp.)
 */
function stripAssTags(text) {
    // Usuń bloki w nawiasach klamrowych: {\...}
    let result = text.replace(/\{[^}]*\}/g, '');
    
    // Zamień \N i \n na nową linię
    result = result.replace(/\\N/g, '\n');
    result = result.replace(/\\n/g, '\n');
    
    // Usuń \h (hard space)
    result = result.replace(/\\h/g, ' ');
    
    return result.trim();
}

/**
 * Konwertuje napisy ASS/SSA do formatu SRT
 */
function convertAssToSrt(assContent) {
    const lines = assContent.split('\n');
    const dialogues = [];
    
    let inEvents = false;
    let formatFields = [];
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Szukamy sekcji [Events]
        if (trimmedLine.toLowerCase() === '[events]') {
            inEvents = true;
            continue;
        }
        
        // Nowa sekcja kończy [Events]
        if (trimmedLine.startsWith('[') && trimmedLine !== '[Events]') {
            inEvents = false;
            continue;
        }
        
        if (!inEvents) continue;
        
        // Parsuj linię Format:
        if (trimmedLine.toLowerCase().startsWith('format:')) {
            const formatStr = trimmedLine.substring(7).trim();
            formatFields = formatStr.split(',').map(f => f.trim().toLowerCase());
            continue;
        }
        
        // Parsuj linie Dialogue:
        if (trimmedLine.toLowerCase().startsWith('dialogue:')) {
            const dialogueStr = trimmedLine.substring(9).trim();
            
            // Rozdziel po przecinkach, ale tekst (ostatnie pole) może zawierać przecinki
            const parts = [];
            let current = '';
            let fieldCount = 0;
            
            for (let i = 0; i < dialogueStr.length; i++) {
                const char = dialogueStr[i];
                
                if (char === ',' && fieldCount < formatFields.length - 1) {
                    parts.push(current.trim());
                    current = '';
                    fieldCount++;
                } else {
                    current += char;
                }
            }
            parts.push(current.trim()); // Ostatnie pole (tekst)
            
            // Znajdź indeksy pól
            const startIdx = formatFields.indexOf('start');
            const endIdx = formatFields.indexOf('end');
            const textIdx = formatFields.indexOf('text');
            
            if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;
            if (parts.length <= Math.max(startIdx, endIdx, textIdx)) continue;
            
            const start = parts[startIdx];
            const end = parts[endIdx];
            const text = stripAssTags(parts[textIdx]);
            
            // Pomiń puste napisy
            if (!text) continue;
            
            dialogues.push({
                start: assTimeToSrt(start),
                end: assTimeToSrt(end),
                text: text
            });
        }
    }
    
    // Sortuj po czasie rozpoczęcia
    dialogues.sort((a, b) => a.start.localeCompare(b.start));
    
    // Generuj SRT
    let srt = '';
    for (let i = 0; i < dialogues.length; i++) {
        const d = dialogues[i];
        srt += `${i + 1}\n`;
        srt += `${d.start} --> ${d.end}\n`;
        srt += `${d.text}\n`;
        srt += '\n';
    }
    
    return srt;
}

// Konfiguracja
const BASE_URL = 'http://animesub.info';
const SEARCH_URL = `${BASE_URL}/szukaj.php`;
const DOWNLOAD_URL = `${BASE_URL}/sciagnij.php`;

// Manifest wtyczki
const manifest = {
    id: 'community.animesub.info',
    version: '1.0.0',
    name: 'AnimeSub.info Subtitles',
    description: 'Polskie napisy do anime z animesub.info',
    logo: 'https://i.imgur.com/qKLYVZx.png',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'kitsu'],
    catalogs: [],
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

// Sesja HTTP z odpowiednimi nagłówkami
const session = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Charset': 'ISO-8859-2,utf-8;q=0.7,*;q=0.3',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pl,en;q=0.9'
    },
    responseType: 'arraybuffer',
    timeout: 15000
});

// Cache dla wyników wyszukiwania
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minut

/**
 * Pobiera informacje o tytule z IMDB/Kitsu
 */
async function getMetaInfo(type, id) {
    // Parsowanie ID
    const parts = id.split(':');
    const prefix = parts[0];
    
    let season = null;
    let episode = null;
    let title = null;
    let year = null;

    // Sprawdź czy to Kitsu czy IMDB
    if (prefix === 'kitsu') {
        // Format Kitsu: kitsu:ANIME_ID:EPISODE
        const kitsuId = parts[1];
        episode = parts.length >= 3 ? parseInt(parts[2], 10) : null;
        
        // Kitsu nie ma sezonów w ten sam sposób - zazwyczaj każdy sezon to osobne anime
        season = 1;

        try {
            // Pobierz dane z Kitsu API
            const kitsuUrl = `https://kitsu.io/api/edge/anime/${kitsuId}`;
            const response = await axios.get(kitsuUrl, {
                headers: {
                    'Accept': 'application/vnd.api+json',
                    'Content-Type': 'application/vnd.api+json'
                },
                timeout: 5000
            });
            
            const anime = response.data.data.attributes;
            // Preferuj tytuł angielski, potem romaji, potem kanoniczny
            title = anime.titles?.en || anime.titles?.en_jp || anime.canonicalTitle || anime.titles?.ja_jp;
            year = anime.startDate ? parseInt(anime.startDate.substring(0, 4), 10) : null;
            
            console.log(`[Kitsu] Pobrano: "${title}" (${year})`);
        } catch (error) {
            console.error('[Kitsu] Błąd pobierania metadanych:', error.message);
        }
        
        return { title, year, season, episode, kitsuId };
        
    } else {
        // Format IMDB: tt1234567 lub tt1234567:1:2
        const imdbId = parts[0];
        
        if (type === 'series' && parts.length >= 3) {
            season = parseInt(parts[1], 10);
            episode = parseInt(parts[2], 10);
        }

        // Próba pobrania tytułu z Cinemeta
        try {
            const metaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
            const response = await axios.get(metaUrl, { timeout: 5000 });
            const meta = response.data.meta;

            return {
                title: meta.name,
                year: meta.year,
                season,
                episode,
                imdbId
            };
        } catch (error) {
            console.error('Błąd pobierania metadanych z Cinemeta:', error.message);
            return { imdbId, season, episode, title: null, year: null };
        }
    }
}

/**
 * Wyszukuje napisy na animesub.info
 */
async function searchSubtitles(title, titleType = 'en') {
    const cacheKey = `${title}:${titleType}`;
    const cached = searchCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Cache hit] ${title}`);
        return cached.results;
    }

    console.log(`[Szukanie] "${title}" (typ: ${titleType})`);

    try {
        const response = await session.get(SEARCH_URL, {
            params: {
                szukane: title,
                pTitle: titleType,
                pSortuj: 'pobrn'
            }
        });

        // Dekodowanie ISO-8859-2
        const html = iconv.decode(Buffer.from(response.data), 'ISO-8859-2');
        const results = parseSearchResults(html);

        searchCache.set(cacheKey, { results, timestamp: Date.now() });
        console.log(`[Znaleziono] ${results.length} napisów`);

        return results;
    } catch (error) {
        console.error('Błąd wyszukiwania:', error.message);
        return [];
    }
}

/**
 * Parsuje wyniki wyszukiwania HTML
 */
function parseSearchResults(html) {
    const $ = cheerio.load(html);
    const subtitles = [];

    $('table.Napisy[style*="text-align:center"]').each((i, table) => {
        try {
            const rows = $(table).find('tr.KNap');
            if (rows.length < 3) return;

            // Wiersz 1: tytuł oryginalny, data, format
            const row1Cells = $(rows[0]).find('td');
            const titleOrg = $(row1Cells[0]).text().trim();
            const formatType = $(row1Cells[3]).text().trim();

            // Wiersz 2: tytuł angielski, autor, rozmiar
            const row2Cells = $(rows[1]).find('td');
            const titleEng = $(row2Cells[0]).text().trim();
            const author = $(row2Cells[1]).find('a').text().trim() || $(row2Cells[1]).text().trim().replace(/^~/, '');

            // Wiersz 3: tytuł alternatywny, liczba pobrań
            const row3Cells = $(rows[2]).find('td');
            const titleAlt = $(row3Cells[0]).text().trim();
            let downloadCount = 0;
            if (row3Cells.length > 3) {
                const countText = $(row3Cells[3]).text().trim();
                downloadCount = parseInt(countText.split(' ')[0], 10) || 0;
            }

            // Formularz pobierania
            const downloadRow = $(table).find('tr.KKom');
            const form = downloadRow.find('form[method="POST"]');
            const subtitleId = form.find('input[name="id"]').val();
            const downloadHash = form.find('input[name="sh"]').val();

            // Opis (pole Synchro)
            const description = downloadRow.find('td.KNap[align="left"]').text().trim();

            if (!subtitleId || !downloadHash) return;

            // Parsowanie numeru odcinka z tytułów
            const episodeInfo = parseEpisodeInfo(titleOrg, titleEng, titleAlt);

            subtitles.push({
                id: subtitleId,
                hash: downloadHash,
                titleOrg,
                titleEng,
                titleAlt,
                author,
                formatType,
                downloadCount,
                description,
                ...episodeInfo
            });
        } catch (error) {
            console.error('Błąd parsowania wiersza:', error.message);
        }
    });

    return subtitles;
}

/**
 * Parsuje informacje o odcinku z tytułów
 */
function parseEpisodeInfo(titleOrg, titleEng, titleAlt) {
    let season = null;
    let episode = null;

    const titles = [titleOrg, titleEng, titleAlt].filter(Boolean);

    for (const title of titles) {
        // Szukanie numeru odcinka: ep01, ep1, episode 01
        if (episode === null) {
            const epMatch = title.match(/(?:ep|episode)\s*(\d+)/i);
            if (epMatch) {
                episode = parseInt(epMatch[1], 10);
            }
        }

        // Szukanie sezonu: Season 3, S3, 2nd Season
        if (season === null) {
            const seasonMatch = title.match(/(?:Season|S)\s*(\d+)|(\d+)(?:nd|rd|th)\s+Season/i);
            if (seasonMatch) {
                season = parseInt(seasonMatch[1] || seasonMatch[2], 10);
            }
        }

        // Sezon implicit: "Title 2 ep01" -> sezon 2
        if (season === null && episode !== null) {
            const implicitMatch = title.match(/\s(\d)\s+ep\d+/i);
            if (implicitMatch) {
                season = parseInt(implicitMatch[1], 10);
            }
        }
    }

    return { season, episode };
}

/**
 * Generuje strategie wyszukiwania dla tytułu
 */
function generateSearchStrategies(title, season, episode) {
    const strategies = [];
    const cleanTitle = title.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

    if (episode !== null) {
        const epStr = String(episode).padStart(2, '0');

        // Strategia 1: Tytuł z sezonem i odcinkiem (dla sezonów > 1)
        if (season && season > 1) {
            strategies.push({ type: 'en', query: `${cleanTitle} Season ${season} ep${epStr}` });
            strategies.push({ type: 'en', query: `${cleanTitle} ${season} ep${epStr}` });
            strategies.push({ type: 'en', query: `${cleanTitle} S${season} ep${epStr}` });
        }

        // Strategia 2: Tytuł z odcinkiem
        strategies.push({ type: 'org', query: `${cleanTitle} ep${epStr}` });
        strategies.push({ type: 'en', query: `${cleanTitle} ep${epStr}` });

        // Strategia 3: Szersze wyszukiwanie z sezonem
        if (season && season > 1) {
            strategies.push({ type: 'en', query: `${cleanTitle} Season ${season}` });
            strategies.push({ type: 'en', query: `${cleanTitle} ${season}` });
        }
    }

    // Strategia 4: Tylko tytuł (ostateczność)
    strategies.push({ type: 'org', query: cleanTitle });
    strategies.push({ type: 'en', query: cleanTitle });

    return strategies;
}

/**
 * Dopasowuje napisy do żądanego odcinka
 */
function matchSubtitles(subtitles, targetSeason, targetEpisode) {
    return subtitles.filter(sub => {
        // Filtrowanie po odcinku
        if (targetEpisode !== null && sub.episode !== null) {
            if (sub.episode !== targetEpisode) return false;
        }

        // Filtrowanie po sezonie
        if (targetSeason !== null && sub.season !== null) {
            if (sub.season !== targetSeason) return false;
        }

        // Jeśli szukamy sezonu 1, a napis nie ma sezonu - akceptujemy
        if (targetSeason === 1 && sub.season === null) {
            return true;
        }

        return true;
    });
}

/**
 * Tworzy URL do napisów (proxy przez nasz serwer)
 */
function createSubtitleUrl(subtitle, searchQuery, searchType) {
    const params = new URLSearchParams({
        id: subtitle.id,
        hash: subtitle.hash,
        query: searchQuery,
        type: searchType
    });
    
    // URL do endpointu pobierania napisów (BASE_URL_RESOLVED ustawiany przy starcie)
    return `${BASE_URL_RESOLVED}/subtitles/download?${params.toString()}`;
}

/**
 * Handler napisów Stremio
 */
builder.defineSubtitlesHandler(async ({ type, id }) => {
    console.log(`\n[Request] type=${type}, id=${id}`);

    try {
        const meta = await getMetaInfo(type, id);
        console.log(`[Meta] title="${meta.title}", season=${meta.season}, episode=${meta.episode}`);

        if (!meta.title) {
            console.log('[Błąd] Nie udało się pobrać tytułu');
            return { subtitles: [] };
        }

        const strategies = generateSearchStrategies(meta.title, meta.season, meta.episode);
        let allSubtitles = [];
        const seenIds = new Set();

        for (const strategy of strategies) {
            console.log(`[Strategia] "${strategy.query}" (${strategy.type})`);
            
            const results = await searchSubtitles(strategy.query, strategy.type);
            const matched = matchSubtitles(results, meta.season, meta.episode);

            for (const sub of matched) {
                if (!seenIds.has(sub.id)) {
                    seenIds.add(sub.id);
                    allSubtitles.push({
                        ...sub,
                        searchQuery: strategy.query,
                        searchType: strategy.type
                    });
                }
            }

            // Jeśli znaleźliśmy dokładne dopasowanie odcinka, przerywamy
            const exactMatch = matched.some(s => 
                s.episode === meta.episode && 
                (meta.season === null || meta.season === 1 || s.season === meta.season)
            );
            
            if (exactMatch && matched.length >= 1) {
                console.log('[Znaleziono] Dokładne dopasowanie, przerywam wyszukiwanie');
                break;
            }

            // Wystarczająco dużo wyników
            if (allSubtitles.length >= 5) {
                console.log('[Znaleziono] Wystarczająco wyników, przerywam wyszukiwanie');
                break;
            }
        }

        // Sortowanie: najpierw po liczbie pobrań
        allSubtitles.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));

        // Konwersja do formatu Stremio
        const stremioSubtitles = allSubtitles.slice(0, 10).map(sub => {
            const label = [
                sub.titleEng || sub.titleOrg,
                sub.author ? `by ${sub.author}` : null,
                sub.formatType,
                sub.downloadCount ? `${sub.downloadCount} pobrań` : null
            ].filter(Boolean).join(' | ');

            return {
                id: `animesub-${sub.id}`,
                url: createSubtitleUrl(sub, sub.searchQuery, sub.searchType),
                lang: 'pol',
                SubtitleName: label
            };
        });

        console.log(`[Wynik] Zwracam ${stremioSubtitles.length} napisów`);
        return { subtitles: stremioSubtitles };

    } catch (error) {
        console.error('[Błąd]', error);
        return { subtitles: [] };
    }
});

// Pobieranie napisów (endpoint proxy)
async function downloadSubtitle(req, res) {
    const { id, hash, query, type } = req.query || req.url.searchParams || {};

    console.log(`[Download] id=${id}, hash=${hash}, query=${query}`);

    if (!id || !hash) {
        res.writeHead(400);
        res.end('Missing parameters');
        return;
    }

    try {
        // WAŻNE: Tworzymy NOWĄ sesję dla każdego pobierania
        // Animesub.info wiąże hash z sesją (ciasteczkami)
        const downloadSession = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pl,en;q=0.9',
                'Accept-Charset': 'ISO-8859-2,utf-8;q=0.7,*;q=0.3',
            },
            timeout: 15000,
            responseType: 'arraybuffer',
            withCredentials: true,
        });

        // Krok 1: Odwiedź stronę wyszukiwania żeby dostać ciasteczka i świeży hash
        const searchParams = new URLSearchParams({
            szukane: query || 'test',
            pTitle: type || 'org',
            pSortuj: 'pobrn'
        });

        const searchUrl = `${SEARCH_URL}?${searchParams.toString()}`;
        console.log(`[Download] Krok 1: Pobieram stronę wyszukiwania`);
        
        const searchResponse = await downloadSession.get(searchUrl);
        
        // Wyciągnij ciasteczka z odpowiedzi
        const cookies = searchResponse.headers['set-cookie'] || [];
        const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
        
        const searchHtml = iconv.decode(Buffer.from(searchResponse.data), 'ISO-8859-2');
        
        // Krok 2: Znajdź ŚWIEŻY hash dla naszego ID
        const $ = cheerio.load(searchHtml);
        let freshHash = null;
        
        $('form[method="POST"][action="sciagnij.php"]').each((i, form) => {
            const formId = $(form).find('input[name="id"]').val();
            if (formId === id || formId === String(id)) {
                freshHash = $(form).find('input[name="sh"]').val();
                console.log(`[Download] ✓ Znaleziono świeży hash dla id=${id}`);
            }
        });

        if (!freshHash) {
            console.log(`[Download] ✗ Nie znaleziono formularza dla id=${id}, używam oryginalnego hasha`);
            freshHash = hash;
        }

        // Krok 3: Pobierz napisy używając TEGO SAMEGO session (z ciasteczkami) i ŚWIEŻEGO hasha
        console.log(`[Download] Krok 2: Pobieram napisy`);
        
        const downloadResponse = await downloadSession.post(DOWNLOAD_URL, 
            new URLSearchParams({
                id: id,
                sh: freshHash,
                single_file: 'Pobierz napisy'
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': searchUrl,
                    'Origin': BASE_URL,
                    'Cookie': cookieString,
                },
                responseType: 'arraybuffer'
            }
        );

        let subtitleContent = Buffer.from(downloadResponse.data);
        console.log(`[Download] Pobrano ${subtitleContent.length} bajtów`);

        // Sprawdź czy to błąd zabezpieczeń
        const rawText = subtitleContent.toString('latin1');
        if (rawText.includes('zabezpiecze') || rawText.includes('Błąd') || rawText.includes('B³±d')) {
            console.log(`[Download] ✗ BŁĄD ZABEZPIECZEŃ!`);
            throw new Error('Błąd zabezpieczeń animesub.info - hash nieważny');
        }

        let subtitleExtension = '.srt';

        // Sprawdzenie czy to ZIP
        if (subtitleContent[0] === 0x50 && subtitleContent[1] === 0x4B) {
            console.log('[Download] Rozpakowywanie ZIP...');
            const zip = new AdmZip(subtitleContent);
            const entries = zip.getEntries();
            
            const subtitleEntry = entries.find(e => 
                /\.(srt|ass|ssa|sub)$/i.test(e.entryName)
            );

            if (subtitleEntry) {
                subtitleContent = subtitleEntry.getData();
                subtitleExtension = require('path').extname(subtitleEntry.entryName) || '.srt';
                console.log(`[Download] Rozpakowano: ${subtitleEntry.entryName}`);
            }
        }

        // Konwersja kodowania do UTF-8
        let textContent;
        try {
            textContent = subtitleContent.toString('utf-8');
            if (textContent.includes('�')) {
                throw new Error('Invalid UTF-8');
            }
        } catch {
            try {
                textContent = iconv.decode(subtitleContent, 'windows-1250');
            } catch {
                textContent = iconv.decode(subtitleContent, 'ISO-8859-2');
            }
        }

        // Konwersja ASS/SSA do SRT (Stremio nie obsługuje ASS)
        if (subtitleExtension === '.ass' || subtitleExtension === '.ssa') {
            console.log('[Download] Konwertuję ASS/SSA do SRT...');
            try {
                const srtContent = convertAssToSrt(textContent);
                
                if (srtContent && srtContent.length > 10) {
                    textContent = srtContent;
                    subtitleExtension = '.srt';
                    console.log(`[Download] ✓ Skonwertowano do SRT`);
                }
            } catch (convError) {
                console.error('[Download] Błąd konwersji ASS->SRT:', convError.message);
            }
        }

        console.log(`[Download] ✓ Wysyłam napisy (${textContent.length} znaków)`);

        // Nagłówki odpowiedzi
        res.writeHead(200, {
            'Content-Type': 'text/srt; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end(textContent);

    } catch (error) {
        console.error('[Download Error]', error.message);
        res.writeHead(500);
        res.end('Download failed: ' + error.message);
    }
}

// Uruchomienie serwera
const PORT = process.env.PORT || 7000;
const http = require('http');

// Automatyczne wykrywanie BASE_URL dla Hugging Face Spaces
if (process.env.BASE_URL) {
    BASE_URL_RESOLVED = process.env.BASE_URL;
} else if (process.env.SPACE_HOST) {
    // Hugging Face Spaces
    BASE_URL_RESOLVED = `https://${process.env.SPACE_HOST}`;
} else if (process.env.SPACE_ID) {
    // Alternatywna metoda dla HF
    const spaceId = process.env.SPACE_ID.replace('/', '-').toLowerCase();
    BASE_URL_RESOLVED = `https://${spaceId}.hf.space`;
} else {
    BASE_URL_RESOLVED = `http://localhost:${PORT}`;
}
console.log(`[Config] BASE_URL: ${BASE_URL_RESOLVED}`);

const addonInterface = builder.getInterface();

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // Obsługa CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400'
        });
        res.end();
        return;
    }
    
    // Endpoint pobierania napisów
    if (url.pathname === '/subtitles/download') {
        req.query = Object.fromEntries(url.searchParams);
        downloadSubtitle(req, res);
        return;
    }
    
    // Standardowe endpointy Stremio
    const addonRouter = getRouter(addonInterface);
    addonRouter(req, res, () => {
        res.writeHead(404);
        res.end('Not found');
    });
});

server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║         AnimeSub.info Stremio Addon                        ║
╠════════════════════════════════════════════════════════════╣
║  Serwer uruchomiony na: http://localhost:${PORT}              ║
║                                                            ║
║  Link do instalacji w Stremio:                             ║
║  http://localhost:${PORT}/manifest.json                       ║
║                                                            ║
║  Aby zainstalować:                                         ║
║  1. Otwórz Stremio                                         ║
║  2. Idź do Addons -> Community Addons                      ║
║  3. Wklej powyższy link w pole "Addon Repository URL"      ║
╚════════════════════════════════════════════════════════════╝
`);
});
