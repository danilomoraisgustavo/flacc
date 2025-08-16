// FLACC — servidor Node.js/Express
// - Servir site estático
// - API /api/gallery lista imagens por ano/tipo lendo as pastas

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const compression = require('compression');

const app = express();
app.disable('x-powered-by');
app.use(compression());

// --- Config ---
const PORT = process.env.PORT || 3000;
// Bases a varrer (ordem = prioridade). Pode mudar via env: GALLERY_BASES="images,assets"
const BASE_DIRS = (process.env.GALLERY_BASES || 'images,assets')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// Extensões permitidas
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

// Tipos conhecidos (mas aceitamos qualquer subpasta como tipo)
const KNOWN_TYPES = new Set(['abertura', 'palestras', 'oficinas', 'exposicoes', 'apresentacoes', 'cartao', 'diversos']);

// Cache simples em memória (30s)
let CACHE = { t: 0, data: null };
const TTL_MS = 30_000;

// Util: comparação "natural" (Imagem2 < Imagem10)
const coll = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const natSort = arr => arr.sort(coll.compare);

// Sanitize helper
const isYear = (name) => /^\d{4}$/.test(name);

// Retorna URL pública para arquivo (ex.: /assets/2019/abertura/Imagem1.jpg)
function toPublicURL(base, segments) {
    const enc = segments.map(s => encodeURIComponent(s));
    return '/' + [base, ...enc].join('/');
}

// Lê árvore de pastas e monta {year:{type:[urls]}}
async function scanOnce() {
    const data = {}; // { "2019": { "abertura": ["/assets/2019/abertura/Imagem1.jpg"] } }

    for (const base of BASE_DIRS) {
        const baseAbs = path.resolve(process.cwd(), base);
        if (!fs.existsSync(baseAbs)) continue;

        const yearDirs = (await fsp.readdir(baseAbs, { withFileTypes: true }))
            .filter(d => d.isDirectory() && isYear(d.name))
            .map(d => d.name);

        for (const year of yearDirs) {
            if (!data[year]) data[year] = {};
            const yearAbs = path.join(baseAbs, year);

            const entries = await fsp.readdir(yearAbs, { withFileTypes: true });

            // 1) Arquivos soltos diretamente no ano -> "diversos"
            const looseFiles = entries.filter(d => d.isFile() && EXT.has(path.extname(d.name).toLowerCase()))
                .map(d => d.name);
            if (looseFiles.length) {
                const type = 'diversos';
                if (!data[year][type]) data[year][type] = [];
                looseFiles.forEach(file => {
                    // se já foi adicionado por outra base, não duplica
                    const url = toPublicURL(base, [year, file]);
                    if (!data[year][type].includes(url)) data[year][type].push(url);
                });
            }

            // 2) Subpastas por tipo
            const typeDirs = entries.filter(d => d.isDirectory()).map(d => d.name);
            for (const type of typeDirs) {
                const typeAbs = path.join(yearAbs, type);
                const files = (await fsp.readdir(typeAbs, { withFileTypes: true }))
                    .filter(d => d.isFile() && EXT.has(path.extname(d.name).toLowerCase()))
                    .map(d => d.name);

                if (!files.length) continue;

                if (!data[year][type]) data[year][type] = [];
                files.forEach(file => {
                    const url = toPublicURL(base, [year, type, file]);
                    if (!data[year][type].includes(url)) data[year][type].push(url);
                });
            }

            // ordena listas dentro do ano
            Object.keys(data[year]).forEach(t => natSort(data[year][t]));
        }
    }

    // ordena tipos (prioriza conhecidos) e anos desc
    const years = Object.keys(data).sort((a, b) => Number(b) - Number(a));
    const ordered = {};
    for (const y of years) {
        const types = Object.keys(data[y]).sort((a, b) => {
            const ak = KNOWN_TYPES.has(a), bk = KNOWN_TYPES.has(b);
            if (ak && !bk) return -1;
            if (!ak && bk) return 1;
            return coll.compare(a, b);
        });
        ordered[y] = {};
        for (const t of types) ordered[y][t] = data[y][t];
    }

    return ordered;
}

async function scanGallery(force = false) {
    const now = Date.now();
    if (!force && CACHE.data && now - CACHE.t < TTL_MS) return CACHE.data;
    const data = await scanOnce();
    CACHE = { t: now, data };
    return data;
}

// --- API ---
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get('/api/gallery', async (req, res) => {
    try {
        const force = 'refresh' in req.query;
        const data = await scanGallery(force);
        res.set('Cache-Control', 'no-cache'); // mantemos o cache interno de 30s
        res.json({
            baseDirs: BASE_DIRS,
            generatedAt: new Date().toISOString(),
            data
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'scan_failed' });
    }
});

// --- Estáticos ---
// Servimos a raiz do projeto (index.html, css, js, assets, images)
app.use(express.static(path.resolve(process.cwd()), {
    maxAge: '7d',
    setHeaders: (res, p) => {
        if (/\.(html)$/i.test(p)) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// SPA fallback (opcional): envia index.html para rotas desconhecidas
app.get('*', (req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'index.html'));
});

// --- Start ---
app.listen(PORT, () => {
    console.log(`FLACC rodando em http://localhost:${PORT}`);
    console.log(`Bases da galeria: ${BASE_DIRS.join(', ')}`);
});
