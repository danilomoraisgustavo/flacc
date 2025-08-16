const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const compression = require('compression');

const app = express();
app.disable('x-powered-by');
app.use(compression());

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const STATIC_DIR = process.env.STATIC_DIR || 'public';
const STATIC_ROOT = path.resolve(process.cwd(), STATIC_DIR);

// Bases a varrer (ordem de prioridade). Ajuste via env GALLERY_BASES.
const BASE_DIRS = (process.env.GALLERY_BASES || 'assets,images')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// Extensões permitidas
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

// Tipos conhecidos (apenas para ordenar primeiro no retorno)
const KNOWN_TYPES = new Set(['Abertura', 'Palestras', 'Oficinas', 'Exposições', 'Apresentações', 'Cartão', 'Diversos']);

// Cache simples (30s)
let CACHE = { t: 0, data: null };
const TTL_MS = 30_000;

// Comparação "natural"
const coll = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const natSort = arr => arr.sort(coll.compare);

// Helpers
const isYear = name => /^\d{4}$/.test(name);
const toPublicURL = (base, segments) =>
    `/${[base, ...segments.map(s => encodeURIComponent(s))].join('/')}`;

// ---------- Scanner ----------
async function scanOnce() {
    const data = {}; // { "2019": { "Abertura": ["/assets/2019/Abertura/Imagem1.jpg"], ... } }

    for (const base of BASE_DIRS) {
        const baseAbs = path.join(STATIC_ROOT, base);
        if (!fs.existsSync(baseAbs)) continue;

        const yearDirs = (await fsp.readdir(baseAbs, { withFileTypes: true }))
            .filter(d => d.isDirectory() && isYear(d.name))
            .map(d => d.name);

        for (const year of yearDirs) {
            if (!data[year]) data[year] = {};
            const yearAbs = path.join(baseAbs, year);
            const entries = await fsp.readdir(yearAbs, { withFileTypes: true });

            // Arquivos soltos no /ANO -> "Diversos"
            const looseFiles = entries
                .filter(d => d.isFile() && EXT.has(path.extname(d.name).toLowerCase()))
                .map(d => d.name);

            if (looseFiles.length) {
                const type = 'Diversos';
                if (!data[year][type]) data[year][type] = [];
                looseFiles.forEach(file => {
                    const url = toPublicURL(base, [year, file]);
                    if (!data[year][type].includes(url)) data[year][type].push(url);
                });
            }

            // Subpastas por tipo (Abertura, Palestras, Exposições, ...)
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

            // Ordena arquivos dentro de cada tipo
            Object.keys(data[year]).forEach(t => natSort(data[year][t]));
        }
    }

    // Ordena anos (desc) e tipos (conhecidos primeiro)
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

// ---------- API ----------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.get('/api/gallery', async (req, res) => {
    try {
        const force = 'refresh' in req.query;
        const data = await scanGallery(force);
        res.set('Cache-Control', 'no-cache');
        res.json({
            staticDir: path.relative(process.cwd(), STATIC_ROOT),
            baseDirs: BASE_DIRS,
            generatedAt: new Date().toISOString(),
            data
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'scan_failed' });
    }
});

// ---------- Estáticos ----------
app.use(express.static(STATIC_ROOT, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        if (/\.html?$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// SPA fallback
app.use((req, res) => {
    res.sendFile(path.join(STATIC_ROOT, 'index.html'));
});


// ---------- Start ----------
app.listen(PORT, () => {
    console.log(`✔ FLACC rodando em http://localhost:${PORT}`);
    console.log(`✔ Estáticos: ${STATIC_ROOT}`);
    console.log(`✔ Bases da galeria: ${BASE_DIRS.join(', ')}`);
});
