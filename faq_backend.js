// Simple Express backend with hybrid FAQ matching + helpdesk (MongoDB)
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const stringSimilarity = require('string-similarity');
const { MongoClient } = require('mongodb');
let bcrypt = null;
let bcryptjs = null;
try { bcrypt = require('bcrypt'); } catch (_) { bcrypt = null; }
if (!bcrypt) {
  try { bcryptjs = require('bcryptjs'); } catch (_) { bcryptjs = null; }
}

const app = express();
app.use(bodyParser.json());

const { spawn } = require('child_process');

// Basic CORS for local dev (Vite @ http://localhost:5173)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// serve uploaded assets (videos/thumbnails)
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));

// Multer for handling file uploads (admin video attachments)
const multer = require('multer');
const UPLOAD_DIR = path.join(__dirname, 'public', 'assets', 'videos');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
    cb(null, safe);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB limit

// Try to transcode uploaded videos to MP4 (H.264 + AAC) for browser playback and generate a thumbnail
async function transcodeToMp4(srcPath) {
  return new Promise((resolve) => {
    try {
      const ext = path.extname(srcPath);
      const base = path.basename(srcPath, ext);
      const outMp4 = path.join(UPLOAD_DIR, `${base}.mp4`);
      const thumbPath = path.join(UPLOAD_DIR, `${base}.jpg`);

      // ffmpeg args for mp4
      const ffArgs = ['-y', '-i', srcPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outMp4];
      const p = spawn('ffmpeg', ffArgs, { stdio: 'ignore' });
      p.on('close', (code) => {
        if (code === 0 && fs.existsSync(outMp4)) {
          // generate thumbnail (attempt) at 1s
          const thumbArgs = ['-y', '-i', outMp4, '-ss', '00:00:01', '-vframes', '1', '-vf', 'scale=320:-1', thumbPath];
          const t = spawn('ffmpeg', thumbArgs, { stdio: 'ignore' });
          t.on('close', () => {
            const relMp4 = `/assets/videos/${path.basename(outMp4)}`;
            const relThumb = fs.existsSync(thumbPath) ? `/assets/videos/${path.basename(thumbPath)}` : null;
            return resolve({ mp4: relMp4, thumbnail: relThumb });
          });
          t.on('error', () => resolve({ mp4: `/assets/videos/${path.basename(outMp4)}`, thumbnail: null }));
        } else {
          return resolve(null);
        }
      });
      p.on('error', () => resolve(null));
    } catch (e) {
      return resolve(null);
    }
  });
}

const DATA_PATH = path.join(__dirname, 'data', 'faq.json');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '20000', 10);
const USE_LLM_DEFAULT = (process.env.USE_LLM || '0') === '1';

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'db_helpdesk_dashboard';

const LOG_DIR = path.join(__dirname, 'logs');
function ensureLogDir() {
  try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}
function logFaqMismatch(entry) {
  try {
    ensureLogDir();
    const file = path.join(LOG_DIR, 'faq_mismatch.log');
    const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}\n`;
    fs.appendFileSync(file, line, 'utf-8');
  } catch (_) { /* swallow logging errors */ }
}
let mongoClient;
async function getMongoClient() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await mongoClient.connect();
  }
  return mongoClient;
}

// Helper: load & save JSON
function loadFaq() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}
function saveFaq(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getQuestionVariants(item) {
  const variants = [];
  if (Array.isArray(item?.variasi_pertanyaan)) variants.push(...item.variasi_pertanyaan);
  if (Array.isArray(item?.variasi)) variants.push(...item.variasi);
  return variants
    .map(v => (v == null ? '' : String(v)).trim())
    .filter(Boolean);
}

function expandFaqForMatching(faqArray) {
  const expanded = [];
  const seen = new Set();
  for (const item of (faqArray || [])) {
    const canonical = (item?.pertanyaan == null ? '' : String(item.pertanyaan)).trim();
    if (!canonical) continue;
    const all = [canonical, ...getQuestionVariants(item)];
    const localSeen = new Set();
    for (const qTextRaw of all) {
      const qText = (qTextRaw == null ? '' : String(qTextRaw)).trim();
      if (!qText) continue;
      const norm = qText.toLowerCase();
      if (localSeen.has(norm)) continue;
      localSeen.add(norm);
      const key = `${canonical.toLowerCase()}|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({ item, qText });
    }
  }
  return expanded;
}

// Extract YouTube ID from various URL formats
function extractYouTubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
  if (m && m[1]) return m[1];
  // try query param v
  try {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.get('v');
  } catch (_) { return null; }
}

// Normalize answer newlines to spaces (previous behavior)
function formatAnswer(text) {
  const raw = String(text || '');
  // normalize newline variants and trim
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  // produce a plain single-line fallback (backwards-compatible)
  const jawaban = normalized.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  // split into logical lines for chat-style rendering; keep bullet items as separate lines
  const jawaban_lines = normalized
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .flatMap(l => {
      // if a line contains multiple list items separated by "- " or "-\t", split them
      if (/\-\s+/.test(l) && !/^\-\s+/.test(l)) {
        // keep numbered lists intact (e.g., "1. ...") but split dash bullets
        return l.split(/\s*-\s+/).map(x => x.trim()).filter(Boolean);
      }
      return [l];
    });
  return { jawaban, jawaban_lines };
}

// Endpoint: tambah pertanyaan ke kategori (mendukung upload video oleh admin)
app.post('/faq/add', upload.array('videos', 5), async (req, res) => {
  try {
    // Support both multipart/form-data (with files) and application/json
    const isMultipart = (req.files && req.files.length > 0) || (req.is && req.is('multipart/form-data'));
    const body = isMultipart ? req.body : req.body;
    const { kategori, pertanyaan, jawaban } = body;
    const katTrim = (kategori || '').trim();
    const qTrim = (pertanyaan || '').trim();
    const aTrim = (jawaban || '').trim();
    if (!katTrim || !qTrim || !aTrim) {
      return res.status(400).json({ error: 'kategori, pertanyaan, dan jawaban wajib diisi' });
    }
    try { fs.accessSync(DATA_PATH, fs.constants.R_OK | fs.constants.W_OK); } catch (e) {
      return res.status(500).json({ error: 'File data tidak bisa diakses untuk tulis/baca', file: DATA_PATH });
    }
    let data = loadFaq();
    let kat = data.find(k => (k.kategori || '').toLowerCase() === katTrim.toLowerCase());
    if (!kat) {
      // create new category if not found
      kat = { kategori: katTrim, faq: [] };
      data.push(kat);
    }
    if (!Array.isArray(kat.faq)) kat.faq = [];

    // Build video metadata from uploaded files (if any) OR from provided video URLs (e.g., YouTube links)
    const files = req.files || [];
    let videos = [];

    // If frontend provided body.videos (JSON array or newline-separated), parse them first
    const providedVideosRaw = body.videos || body.video_links || body.videoLinks;
    if (providedVideosRaw) {
      let list = [];
      if (Array.isArray(providedVideosRaw)) list = providedVideosRaw;
      else if (typeof providedVideosRaw === 'string') {
        try { list = JSON.parse(providedVideosRaw); } catch (_) { list = providedVideosRaw.split('\n').map(s => s.trim()).filter(Boolean); }
      }
      for (const link of list) {
        const url = (link || '').trim();
        if (!url) continue;
        const ytId = extractYouTubeId(url);
        if (ytId) {
          videos.push({ title: null, url, embed: `https://www.youtube.com/embed/${ytId}`, source: 'youtube', thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`, mime: 'video/youtube' });
        } else {
          // generic external link
          videos.push({ title: null, url, source: 'external', thumbnail: null, mime: null });
        }
      }
    }

    // Next process any uploaded files (legacy behavior)
    for (const f of files) {
      const origRel = `/assets/videos/${path.basename(f.filename)}`;
      const meta = {
        title: f.originalname,
        url: origRel,
        original_url: origRel,
        source: 'local',
        thumbnail: null,
        size: f.size,
        mime: f.mimetype,
      };
      try {
        const srcPath = path.join(UPLOAD_DIR, f.filename);
        const trans = await transcodeToMp4(srcPath);
        if (trans && trans.mp4) {
          meta.original_url = origRel;
          meta.url = trans.mp4; // prefer mp4 for playback
          if (trans.thumbnail) meta.thumbnail = trans.thumbnail;
          // update mime for playback
          meta.mime = 'video/mp4';
        }
      } catch (_) {}
      videos.push(meta);
    }

    // If frontend provided videos but our parsing didn't produce structured entries,
    // fall back to storing raw links so they are not lost. Also handle some edge
    // cases where the payload may have been mangled by middleware.
    if ((providedVideosRaw) && videos.length === 0) {
      try {
        let list = [];
        if (Array.isArray(providedVideosRaw)) list = providedVideosRaw;
        else if (typeof providedVideosRaw === 'string') {
          try { list = JSON.parse(providedVideosRaw); } catch (_) { list = providedVideosRaw.split('\n').map(s => s.trim()).filter(Boolean); }
        } else if (typeof providedVideosRaw === 'object' && providedVideosRaw !== null) {
          // if it's an object, try to extract array-like values
          for (const k of Object.keys(providedVideosRaw)) {
            const v = providedVideosRaw[k];
            if (Array.isArray(v)) list.push(...v);
            else if (typeof v === 'string') list.push(v);
          }
        }
        for (const link of list) {
          const url = (link || '').trim();
          if (!url) continue;
          const ytId = extractYouTubeId(url);
          if (ytId) videos.push({ title: null, url, embed: `https://www.youtube.com/embed/${ytId}`, source: 'youtube', thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`, mime: 'video/youtube' });
          else videos.push({ title: null, url, source: 'external' });
        }
      } catch (_) {}
    }

    // Final fallback: scan the entire request body for any YouTube/external links (catch-all)
    if (videos.length === 0) {
      try {
        const collected = new Set();
        function scanObj(o) {
          if (!o) return;
          if (typeof o === 'string') {
            const s = o.trim();
            if (/https?:\/\/.+/.test(s)) collected.add(s);
            return;
          }
          if (Array.isArray(o)) {
            for (const it of o) scanObj(it);
            return;
          }
          if (typeof o === 'object') {
            for (const k of Object.keys(o)) scanObj(o[k]);
          }
        }
        scanObj(body);
        for (const url of Array.from(collected)) {
          const ytId = extractYouTubeId(url);
          if (ytId) videos.push({ title: null, url, embed: `https://www.youtube.com/embed/${ytId}`, source: 'youtube', thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`, mime: 'video/youtube' });
          else videos.push({ title: null, url, source: 'external' });
        }
      } catch (_) {}
    }

    // Debug: log what we received so we can trace why videos might be missing
    try { console.log('[faq/add] headers:', req.headers['content-type']); } catch (_) {}
    try { console.log('[faq/add] providedVideosRaw type:', typeof providedVideosRaw, 'value:', providedVideosRaw); } catch (_) {}
    try { console.log('[faq/add] parsed videos count:', videos.length); } catch (_) {}

    const newFaq = { pertanyaan: qTrim, jawaban: aTrim };
    // Variasi pertanyaan (opsional) - bisa dikirim sebagai JSON array atau teks baris-per-baris
    if (Object.prototype.hasOwnProperty.call(body, 'variasi_pertanyaan')) {
      let rawVar = body.variasi_pertanyaan;
      let arr = [];
      if (Array.isArray(rawVar)) arr = rawVar;
      else if (typeof rawVar === 'string') {
        const trimmed = rawVar.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) arr = parsed;
            else arr = trimmed.split('\n');
          } catch (_) {
            arr = trimmed.split('\n');
          }
        }
      }
      const cleaned = arr
        .map(v => (v == null ? '' : String(v)).trim())
        .filter(Boolean);
      if (cleaned.length) newFaq.variasi_pertanyaan = cleaned;
    }
    // Ensure that if the client provided video links in any recognized field,
    // they are persisted even if earlier parsing failed to build structured metadata.
    if (videos.length) {
      newFaq.videos = videos;
    } else if (providedVideosRaw) {
      // last-resort: persist raw links so they are not lost
      const list = Array.isArray(providedVideosRaw) ? providedVideosRaw : (typeof providedVideosRaw === 'string' ? providedVideosRaw.split('\n').map(s => s.trim()).filter(Boolean) : []);
      if (list.length) newFaq.videos = list.map(u => ({ title: null, url: String(u).trim(), source: 'external' }));
    }
    kat.faq.push(newFaq);

    try { saveFaq(data); } catch (e) { return res.status(500).json({ error: 'Gagal menyimpan perubahan ke file', file: DATA_PATH, detail: e.message }); }
    res.json({ success: true, message: 'FAQ berhasil ditambahkan', file: DATA_PATH, totalFaq: kat.faq.length, item: newFaq });
  } catch (err) {
    res.status(500).json({ error: 'Terjadi kesalahan saat menambah FAQ', detail: err && err.message ? err.message : String(err) });
  }
});

// Endpoint: ambil daftar FAQ per kategori (untuk admin edit)
app.get('/faq/list', (req, res) => {
  try {
    const kategori = (req.query.kategori || '').toString().trim();
    const data = loadFaq();
    if (kategori) {
      const katObj = data.find(k => (k.kategori || '').toLowerCase() === kategori.toLowerCase());
      if (!katObj) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
      const items = Array.isArray(katObj.faq) ? katObj.faq.map((f, idx) => ({
        index: idx,
        pertanyaan: f.pertanyaan || '',
        jawaban: f.jawaban || '',
        variasi_pertanyaan: Array.isArray(f.variasi_pertanyaan) ? f.variasi_pertanyaan : [],
        videos: f.videos || [],
      })) : [];
      return res.json({ kategori: katObj.kategori, items });
    }
    // jika kategori tidak diisi, kembalikan semua kategori + ringkasan FAQ
    const categories = data.map(k => ({
      kategori: k.kategori,
      items: (Array.isArray(k.faq) ? k.faq : []).map((f, idx) => ({
        index: idx,
        pertanyaan: f.pertanyaan || '',
        jawaban: f.jawaban || '',
        variasi_pertanyaan: Array.isArray(f.variasi_pertanyaan) ? f.variasi_pertanyaan : [],
        videos: f.videos || [],
      })),
    }));
    return res.json({ categories });
  } catch (err) {
    return res.status(500).json({ error: 'Gagal mengambil daftar FAQ', detail: err && err.message ? err.message : String(err) });
  }
});

// Endpoint: update pertanyaan/jawaban FAQ + variasi & (opsional) video
app.post('/faq/update', upload.array('videos', 5), async (req, res) => {
  try {
    const body = req.body || {};
    const kategori = (body.kategori || '').trim();
    const pertanyaan = (body.pertanyaan || '').trim();
    const jawaban = (body.jawaban || '').trim();
    const idxRaw = body.index;
    const index = typeof idxRaw === 'string' || typeof idxRaw === 'number' ? parseInt(String(idxRaw), 10) : NaN;

    if (!kategori || !pertanyaan || !jawaban) {
      return res.status(400).json({ error: 'kategori, pertanyaan, dan jawaban wajib diisi' });
    }
    if (!Number.isFinite(index) || index < 0) {
      return res.status(400).json({ error: 'index FAQ tidak valid' });
    }

    try { fs.accessSync(DATA_PATH, fs.constants.R_OK | fs.constants.W_OK); } catch (e) {
      return res.status(500).json({ error: 'File data tidak bisa diakses untuk tulis/baca', file: DATA_PATH });
    }

    const data = loadFaq();
    const katObj = data.find(k => (k.kategori || '').toLowerCase() === kategori.toLowerCase());
    if (!katObj || !Array.isArray(katObj.faq)) {
      return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    }
    if (index >= katObj.faq.length) {
      return res.status(404).json({ error: 'FAQ dengan index tersebut tidak ditemukan' });
    }
    const item = katObj.faq[index];
    item.pertanyaan = pertanyaan;
    item.jawaban = jawaban;

    // Update variasi_pertanyaan jika dikirim oleh frontend (satu per baris atau JSON array)
    if (Object.prototype.hasOwnProperty.call(body, 'variasi_pertanyaan')) {
      let rawVar = body.variasi_pertanyaan;
      let arr = [];
      if (Array.isArray(rawVar)) arr = rawVar;
      else if (typeof rawVar === 'string') {
        const trimmed = rawVar.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) arr = parsed;
            else arr = trimmed.split('\n');
          } catch (_) {
            arr = trimmed.split('\n');
          }
        }
      }
      item.variasi_pertanyaan = arr
        .map(v => (v == null ? '' : String(v)).trim())
        .filter(Boolean);
    }

    // Opsional: ganti daftar video jika admin mengirim data video baru
    const files = req.files || [];
    const providedVideosRaw = body.videos || body.video_links || body.videoLinks;
    const existingVideosRaw = body.existing_videos || body.existingVideos;

    const hasVideoField = Object.prototype.hasOwnProperty.call(body, 'existing_videos') ||
      Object.prototype.hasOwnProperty.call(body, 'existingVideos') ||
      (files && files.length > 0) ||
      (typeof providedVideosRaw === 'string' && providedVideosRaw.trim().length > 0) ||
      (Array.isArray(providedVideosRaw) && providedVideosRaw.length > 0);

    if (hasVideoField) {
      let videos = [];

      // 0) Gabungkan video yang ingin dipertahankan dari client (biasanya video lokal lama)
      if (existingVideosRaw) {
        let parsed = [];
        if (Array.isArray(existingVideosRaw)) parsed = existingVideosRaw;
        else if (typeof existingVideosRaw === 'string') {
          try { parsed = JSON.parse(existingVideosRaw); } catch (_) { parsed = []; }
        }
        if (Array.isArray(parsed)) {
          for (const v of parsed) {
            if (v && typeof v === 'object') videos.push(v);
          }
        }
      }

      // 1) Proses link yang dikirim (YouTube / external)
      if (providedVideosRaw) {
        let list = [];
        if (Array.isArray(providedVideosRaw)) list = providedVideosRaw;
        else if (typeof providedVideosRaw === 'string') {
          try { list = JSON.parse(providedVideosRaw); }
          catch (_) { list = providedVideosRaw.split('\n').map(s => s.trim()).filter(Boolean); }
        }
        for (const link of list) {
          const url = (link || '').trim();
          if (!url) continue;
          const ytId = extractYouTubeId(url);
          if (ytId) {
            videos.push({
              title: null,
              url,
              embed: `https://www.youtube.com/embed/${ytId}`,
              source: 'youtube',
              thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
              mime: 'video/youtube',
            });
          } else {
            videos.push({ title: null, url, source: 'external', thumbnail: null, mime: null });
          }
        }
      }

      // 2) Proses file upload baru (jika ada)
      for (const f of files) {
        const origRel = `/assets/videos/${path.basename(f.filename)}`;
        const meta = {
          title: f.originalname,
          url: origRel,
          original_url: origRel,
          source: 'local',
          thumbnail: null,
          size: f.size,
          mime: f.mimetype,
        };
        try {
          const srcPath = path.join(UPLOAD_DIR, f.filename);
          const trans = await transcodeToMp4(srcPath);
          if (trans && trans.mp4) {
            meta.original_url = origRel;
            meta.url = trans.mp4;
            if (trans.thumbnail) meta.thumbnail = trans.thumbnail;
            meta.mime = 'video/mp4';
          }
        } catch (_) {}
        videos.push(meta);
      }

      // Jika ada hasil parsing, ganti item.videos sepenuhnya
      if (videos.length) {
        item.videos = videos;
      } else if (providedVideosRaw) {
        // fallback: simpan link mentah sebagai external
        let list = [];
        if (Array.isArray(providedVideosRaw)) list = providedVideosRaw;
        else if (typeof providedVideosRaw === 'string') {
          try { list = JSON.parse(providedVideosRaw); }
          catch (_) { list = providedVideosRaw.split('\n').map(s => s.trim()).filter(Boolean); }
        }
        item.videos = list
          .map(u => ({ title: null, url: String(u).trim(), source: 'external' }))
          .filter(v => v.url);
      } else {
        // Jika field video eksplisit dikirim tapi kosong, berarti hapus semua video
        item.videos = [];
      }
    }

    try { saveFaq(data); } catch (e) { return res.status(500).json({ error: 'Gagal menyimpan perubahan ke file', file: DATA_PATH, detail: e.message }); }
    return res.json({ success: true, message: 'FAQ berhasil diupdate', file: DATA_PATH, kategori: katObj.kategori, index });
  } catch (err) {
    return res.status(500).json({ error: 'Terjadi kesalahan saat mengupdate FAQ', detail: err && err.message ? err.message : String(err) });
  }
});

// Endpoint: ambil list kategori
app.get('/faq/categories', (req, res) => {
  let data = loadFaq();
  res.json(data.map(k => k.kategori));
});

// Ollama / LLM helpers
function decideUseLlm(req) {
  if (typeof req.body?.use_llm === 'boolean') return req.body.use_llm;
  if (req.query?.llm === '1') return true;
  return USE_LLM_DEFAULT;
}

async function generateWithOllama(prompt) {
  const url = `${OLLAMA_URL}/api/generate`;
  const body = { model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.2, num_ctx: 4096 } };
  try {
    const res = await axios.post(url, body, { timeout: OLLAMA_TIMEOUT });
    return (res.data && res.data.response) ? res.data.response : '';
  } catch (e) {
    if (e.response && e.response.status === 404) {
      const hint = `Ollama 404: model "${OLLAMA_MODEL}" tidak ditemukan atau Ollama belum berjalan. Jalankan: 'ollama serve' lalu 'ollama pull ${OLLAMA_MODEL}'.`;
      const err = new Error(hint); err.code = 404; throw err;
    }
    if (e.code === 'ECONNREFUSED') {
      const err = new Error(`Tidak bisa konek ke Ollama di ${OLLAMA_URL}. Pastikan layanan berjalan: 'ollama serve'.`); err.code = 'ECONNREFUSED'; throw err;
    }
    throw e;
  }
}

async function getOllamaTags() {
  const url = `${OLLAMA_URL}/api/tags`;
  const res = await axios.get(url, { timeout: OLLAMA_TIMEOUT });
  return res.data && res.data.models ? res.data.models : [];
}

function buildOllamaPrompt(question, topResults) {
  const contextBlocks = topResults.map((r, i) => `#${i + 1} Pertanyaan: ${r.payload?.pertanyaan || r.payload?.pertanyaan}
Jawaban: ${r.payload?.jawaban || r.payload?.jawaban}`).join('\n\n');
  const instructions = [
    'Anda adalah asisten FAQ perusahaan. Jawab dalam bahasa Indonesia.',
    'Gunakan hanya informasi pada konteks di bawah ini. Jangan membuat informasi baru.',
    'Jika jawaban tidak ada di konteks, balas singkat: "Maaf, belum ada jawaban. Silakan perjelas pertanyaan atau pilih kategori yang tersedia."',
    'Ringkas dan jelas, maksimal 1-2 kalimat.'
  ].join(' ');
  return `${instructions}\n\nPertanyaan pengguna: ${question}\n\nKonteks:\n${contextBlocks}\n\nJawaban:`;
}

async function getEmbedding(text) {
  const res = await axios.post('http://localhost:5001/embed', { texts: [text] });
  return res.data.vectors[0];
}

async function searchQdrant(embedding, kategori) {
  const url = 'http://localhost:6333/collections/faq_semantic/points/search';
  const filter = kategori ? { must: [{ key: 'kategori', match: { value: kategori } }] } : undefined;
  const body = { vector: embedding, filter, top: 10, with_payload: true };
  const res = await axios.post(url, body);
  return res.data.result || [];
}

// Main FAQ ask endpoint (hybrid)
app.post('/faq/ask', async (req, res) => {
  const { kategori, pertanyaan } = req.body;
  if (!kategori || !pertanyaan) return res.status(400).json({ error: 'kategori dan pertanyaan wajib diisi' });
  try {
    // normalization utilities
    const normalizeSpaces = s => (s || '').replace(/\s+/g, ' ').trim();
    const stripPunct = s => (s || '').replace(/[\?\.!,:;"'()\[\]{}\/\-\u2013\u2014]/g, ' ');
    const toLower = s => String(s ?? '').toLowerCase();
    const canonicalize = s => s
      .replace(/\b(buat|untuk) apa\b/g, 'apa fungsi')
      .replace(/\bmenghapus(kan)?\b/g, 'hapus')
      .replace(/\b(pengen|mau)\b/g, 'ingin')
      .replace(/\b(nggak|ga|gak|gk)\b/g, 'tidak')
      .replace(/\blihat laporan\b/g, 'akses laporan')
      .replace(/\b(admin|sales|kasir|owner|spv|supervisor)\b/g, 'user')
      .replace(/\beod\b/g, 'laporan eod')
      .replace(/\busers\b/g, 'user')
      .replace(/\bstock\b/g, 'stok')
      .replace(/\bmargin penjualan\b/g, 'penjualan margin')
      .replace(/\bmelihat\b/g, 'lihat')
      .replace(/\bliat\b/g, 'lihat')
      .replace(/\bdiliat\b/g, 'lihat')
      .replace(/\bdilihat\b/g, 'lihat')
      .replace(/\binfo\b/g, 'informasi')
      .replace(/\bpenjuana\b/g, 'penjualan')
      .replace(/\bpenjualn\b/g, 'penjualan')
      .replace(/\bgimana\b/g, 'bagaimana')
      // normalize synonyms requested by user
      .replace(/\b(untuk|gunanya|kegunaan|buat|fungsi|itu)\b/g, 'fungsi')
      .replace(/\b(reprint|re-print|cetak ulang|mencetak ulang|re print)\b/g, 'reprint')
      .replace(/\b(langkah-langkah|langkah langkah|langkah-langkah|langkah| gimana|bagaimana| step| step-step, step step| tahap| tahapan)\b/g, 'cara')
      .replace(/\b(action|button|tombol|aksi|)\b/g, 'tombol');
    const normalizeFull = s => canonicalize(normalizeSpaces(stripPunct(toLower(s))));

    // token helpers
    const stopTokens = new Set(['yang','atau','dari','dalam','pada','untuk','dengan','apa','saja','anda','dan','di','ke','ini','itu','bagaimana','gimana','cara','buat','menu','nya','dong','sih','tuh','kah','lah','tolong','mohon','ingin','pengen','mau','agar','supaya','biar','tidak','bisa','boleh']);
    const tokenize = s => normalizeFull(s).split(' ').map(t => t.trim()).filter(t => t.length >= 3 && !stopTokens.has(t));
    const tokenContainmentScore = (userTokens, faqTokens) => { if (!userTokens.length) return 0; const faqSet = new Set(faqTokens); let hit = 0; for (const t of userTokens) if (faqSet.has(t)) hit++; return hit / userTokens.length; };

    const normalizedQuestion = normalizeSpaces(toLower(pertanyaan || ''));
    const dataAll = loadFaq();
    const katObj = dataAll.find(k => k.kategori.toLowerCase() === kategori.toLowerCase());
    if (!katObj) {
      const useLlmCat = decideUseLlm(req);
      if (useLlmCat) {
        try {
          const prompt = buildOllamaPrompt(pertanyaan, []);
          const llmOutput = await generateWithOllama(prompt);
          const formatted = formatAnswer(llmOutput);
          return res.json({ mode: 'llm-no-category', pertanyaan, score: 0, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines });
        } catch (e) {
          return res.status(404).json({ error: 'Maaf, belum ada jawaban.' });
        }
      }
      return res.status(404).json({ error: 'Maaf, belum ada jawaban.' });
    }

    if (katObj && Array.isArray(katObj.faq)) {
      const expandedFaq = expandFaqForMatching(katObj.faq);
      // Early rule-based
      const allTokensEarly = normalizeFull(normalizedQuestion).split(' ');
      const qTokensEarly = allTokensEarly.filter(t => t.length >= 3 && !stopTokens.has(t));
      const wantsInfoEarly = (allTokensEarly.includes('lihat') || allTokensEarly.includes('informasi') || allTokensEarly.includes('ditampilkan') || allTokensEarly.includes('liat') || allTokensEarly.includes('diliat') || allTokensEarly.includes('dilihat') || (allTokensEarly.includes('apa') && allTokensEarly.includes('saja')));
      if (wantsInfoEarly && qTokensEarly.length) {
        const preferredEarly = expandedFaq.find(c => { const qn = normalizeFull(c.qText); if (!(qn.includes('informasi') || qn.includes('ditampilkan'))) return false; return qTokensEarly.every(tok => qn.includes(tok)); });
        if (preferredEarly) { const formattedPref = formatAnswer(preferredEarly.item.jawaban); return res.json({ pertanyaan: preferredEarly.item.pertanyaan, score: 0.99, jawaban: formattedPref.jawaban, jawaban_lines: formattedPref.jawaban_lines, videos: preferredEarly.item.videos || [], mode: 'rule-early' }); }
      }

      const normQ = normalizeFull(pertanyaan);
      const exact = expandedFaq.find(c => normalizeFull(c.qText) === normQ);
      if (exact) { const formatted = formatAnswer(exact.item.jawaban); return res.json({ pertanyaan: exact.item.pertanyaan, score: 1, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines, videos: exact.item.videos || [], mode: 'exact' }); }

      try {
        const userTokens = tokenize(pertanyaan);
        const isSingleAcronym = userTokens.length === 1 && /^[a-z]+$/.test(userTokens[0]) && userTokens[0].length <= 4;
        if (userTokens.length >= 2 || isSingleAcronym) {
          let best = null; let bestScore = 0; let bestFaqLen = Infinity;
          for (const c of expandedFaq) {
            const faqTokens = tokenize(c.qText);
            const score = tokenContainmentScore(userTokens, faqTokens);
            // prefer higher score, but break ties by choosing the shorter (more specific) FAQ
            if (score > bestScore || (score === bestScore && faqTokens.length < bestFaqLen)) {
              bestScore = score; best = c.item; bestFaqLen = faqTokens.length;
            }
          }
          // relaxed token threshold so near-matches are accepted
          const thresholdTok = isSingleAcronym ? 1.0 : 0.6;
          if (best && bestScore >= thresholdTok) { const formatted = formatAnswer(best.jawaban); return res.json({ pertanyaan: best.pertanyaan, score: bestScore, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines, videos: best.videos || [], mode: 'token-match' }); }
        }
      } catch (_) {}

      try {
        const candidates = expandedFaq.map(c => ({ item: c.item, norm: normalizeFull(c.qText) }));
        const match = stringSimilarity.findBestMatch(normQ, candidates.map(c => c.norm));
        const best = candidates[match.bestMatchIndex];
        // relaxed fuzzy threshold to accept more near-matches
        const FUZZY_THRESHOLD = 0.45;
        if (match.bestMatch.rating >= FUZZY_THRESHOLD) { const formatted = formatAnswer(best.item.jawaban); return res.json({ pertanyaan: best.item.pertanyaan, score: match.bestMatch.rating, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines, videos: best.item.videos || [], mode: 'local-fuzzy' }); }
        // log near-miss fuzzy attempts for tuning
        if (match.bestMatch.rating > 0.3) {
          try { logFaqMismatch({ type: 'fuzzy-nearmiss', kategori, question: pertanyaan, bestRating: match.bestMatch.rating, candidateQuestion: best && best.item ? best.item.pertanyaan : null }); } catch(_) {}
        }
      } catch (_) {}
    }

    // semantic search via embedding + qdrant
    let results = [];
    try {
      const embedding = await getEmbedding(normalizedQuestion);
      results = await searchQdrant(embedding, kategori.toUpperCase());
    } catch (e) {
      // try various fallbacks, simplified: fall through to fallback LLM/local fuzzy handled below
      results = [];
    }

    if (!results.length) {
      // log semantic search empty result for later analysis
      try { logFaqMismatch({ type: 'semantic-empty', kategori, question: pertanyaan }); } catch(_) {}
      const useLlm = decideUseLlm(req);
      if (useLlm) {
        try {
          const prompt = buildOllamaPrompt(pertanyaan, []);
          const llmOutput = await generateWithOllama(prompt);
          const formatted = formatAnswer(llmOutput);
          return res.json({ mode: 'llm-empty', pertanyaan, score: 0, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines });
        } catch (e) { return res.status(404).json({ error: 'Maaf, belum ada jawaban. Silakan perjelas pertanyaan atau pilih kategori yang tersedia.' }); }
      }
      return res.status(404).json({ error: 'Maaf, belum ada jawaban. Silakan perjelas pertanyaan atau pilih kategori yang tersedia.' });
    }

    // Hybrid reranker: combine Qdrant + lexical
    const topResults = results.slice(0, 5);
    const expandedFaqForLex = (katObj && Array.isArray(katObj.faq)) ? expandFaqForMatching(katObj.faq) : [];
    const lexicalCandidates = expandedFaqForLex.map(c => ({ item: c.item, norm: normalizeFull(c.qText) })).filter(c => normalizedQuestion.split(' ').some(t => c.norm.includes(t))).slice(0,50);

    const candidateMap = new Map();
    topResults.forEach(r => { const key = r.payload.pertanyaan; if (!candidateMap.has(key)) candidateMap.set(key, { source: 'qdrant', qdrantScore: r.score || 0, item: r.payload }); else candidateMap.get(key).qdrantScore = Math.max(candidateMap.get(key).qdrantScore, r.score || 0); });
    lexicalCandidates.forEach(c => { const key = c.item.pertanyaan; if (!candidateMap.has(key)) candidateMap.set(key, { source: 'lexical', qdrantScore: 0, item: c.item }); });

    const compareTwo = stringSimilarity.compareTwoStrings;
    const scored = Array.from(candidateMap.values()).map(c => {
      const candQ = normalizeFull(c.item.pertanyaan);
      const candTokens = candQ.split(' ').filter(t => t.length >= 3);
      const inter = candTokens.filter(t => normalizedQuestion.includes(t));
      const union = Array.from(new Set([...candTokens, ...normalizedQuestion.split(' ')]));
      const overlap = union.length ? (inter.length / union.length) : 0;
      const sim = compareTwo(normalizeFull(normalizedQuestion), candQ);
      const composite = (0.60 * c.qdrantScore) + (0.28 * sim) + (0.12 * overlap);
      return { ...c, sim, overlap, composite };
    });
    scored.sort((a,b) => b.composite - a.composite);
    const best = scored[0];
    // relaxed composite threshold; log low-confidence picks
    const COMPOSITE_THRESHOLD = 0.45;
    if (!best || best.composite < COMPOSITE_THRESHOLD) {
      try { logFaqMismatch({ type: 'low-composite', kategori, question: pertanyaan, topCandidates: scored.slice(0,3).map(s => ({ q: s.item.pertanyaan, composite: s.composite })) }); } catch(_) {}
      return res.status(404).json({ error: 'Maaf, kami belum menemukan jawaban yang sesuai. Silakan perjelas pertanyaan atau pilih kategori yang tersedia.' });
    }
    const formatted = formatAnswer(best.item.jawaban);
    const useLlm = decideUseLlm(req);
    if (useLlm) {
      try {
        const ctxTop = scored.slice(0,5).map(s => ({ payload: { pertanyaan: s.item.pertanyaan, jawaban: s.item.jawaban } }));
        const prompt = buildOllamaPrompt(pertanyaan, ctxTop);
        const llmOutput = await generateWithOllama(prompt);
        const formattedLlm = formatAnswer(llmOutput);
        return res.json({ mode: 'llm', pertanyaan: best.item.pertanyaan, score: best.qdrantScore || best.sim, jawaban: formattedLlm.jawaban, jawaban_lines: formattedLlm.jawaban_lines, videos: best.item.videos || [] });
      } catch (e) { return res.json({ mode: 'fallback', pertanyaan: best.item.pertanyaan, score: best.qdrantScore || best.sim, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines, videos: best.item.videos || [], llmError: e && e.message ? e.message : 'LLM gagal' }); }
    }
    res.json({ pertanyaan: best.item.pertanyaan, score: best.qdrantScore || best.sim, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines, videos: best.item.videos || [] });
  } catch (err) {
    const useLlmAny = decideUseLlm(req);
    if (useLlmAny) {
      try {
        const prompt = buildOllamaPrompt(pertanyaan, []);
        const llmOutput = await generateWithOllama(prompt);
        const formatted = formatAnswer(llmOutput);
        return res.json({ mode: 'llm-catch', pertanyaan, score: 0, jawaban: formatted.jawaban, jawaban_lines: formatted.jawaban_lines });
      } catch (e) { return res.status(404).json({ error: 'Maaf, belum ada jawaban.' }); }
    }
    return res.status(404).json({ error: 'Maaf, belum ada jawaban.' });
  }
});

// Helpdesk endpoints (MongoDB-backed)
app.post('/helpdesk/ask', async (req, res) => {
  // Accept either userId (legacy) or userName / user_name from frontend
  const { userId, userName, user_name, question } = req.body;
  const suppliedUserId = userId || (userName || user_name) || null;
  if (!question) return res.status(400).json({ error: 'Pertanyaan wajib diisi' });
  try {
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const now = new Date();
    let conv = await db.collection('conversations').findOne({ user_id: suppliedUserId || 'USR001', status: { $in: ['PENDING','OPEN','IN_PROGRESS'] } });
    let conversation_id;
    if (conv) {
      conversation_id = conv.conversation_id;
      await db.collection('conversations').updateOne({ conversation_id }, { $set: { updated_at: now, user_name: (userName || user_name) || conv.user_name || null } });
    } else {
      conversation_id = 'CONV-' + now.getTime();
      await db.collection('conversations').insertOne({ conversation_id, user_id: suppliedUserId || 'USR001', user_name: (userName || user_name) || null, status: 'PENDING', source: 'chatbot', created_at: now, updated_at: now, assigned_to: null, priority: 'normal' });
    }
    const insertRes = await db.collection('messages').insertOne({ conversation_id, sender: 'USER', message: question, created_at: now, is_read: false, user_name: (userName || user_name) || null });
    // Return inserted message id as string so frontend can map temporary client id to server id
    const messageId = insertRes.insertedId ? String(insertRes.insertedId) : null;
    res.json({ success: true, conversation_id, message_id: messageId });
  } catch (err) { res.status(500).json({ error: 'Gagal menyimpan ke MongoDB', detail: String(err) }); }
});

// Admin login using agents collection in MongoDB
app.post('/admin/login', async (req, res) => {
  // Accept email + password to match agents collection structure
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    const emailLower = String(email || '').toLowerCase();
    const agent = await db.collection('agents').findOne({ $or: [{ email }, { emailLower }] });
    if (!agent) return res.status(401).json({ error: 'Invalid credentials' });
    const stored = agent.passwordHash || agent.password || agent.pass || agent.hash || '';
    let ok = false;
    if (typeof stored === 'string' && stored.startsWith('$2')) {
      if (bcrypt) {
        try { ok = await bcrypt.compare(String(password), stored); } catch (_) { ok = false; }
      } else if (bcryptjs) {
        try { ok = bcryptjs.compareSync(String(password), stored); } catch (_) { ok = false; }
      } else {
        ok = false;
      }
    } else {
      // fallback: plain-text compare
      ok = String(password) === String(stored);
    }
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    // Success: return basic agent profile (do not return password)
    const profile = { email: agent.email, fullName: agent.fullName || agent.name || agent.displayName || agent.fullname || agent.email, roles: agent.roles || [] };
    return res.json({ success: true, agent: profile });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed', detail: String(err) });
  }
});

app.get('/helpdesk/messages', async (req, res) => {
  const conversation_id = req.query.conversation_id;
  if (!conversation_id) return res.status(400).json({ error: 'conversation_id wajib diisi' });
  try {
    const client = await getMongoClient();
    const db = client.db(MONGODB_DB);
    await db.collection('messages').updateMany({ conversation_id, sender: 'USER', is_read: false }, { $set: { is_read: true } });
    const messages = await db.collection('messages').find({ conversation_id }).sort({ created_at: 1 }).limit(50).toArray();
    const conv = await db.collection('conversations').findOne({ conversation_id });
    const conversation = conv ? { conversation_id: conv.conversation_id, status: conv.status, updated_at: conv.updated_at } : null;
    res.json({ messages, conversation });
  } catch (err) { res.status(500).json({ error: 'Gagal mengambil pesan helpdesk', detail: String(err) }); }
});

app.patch('/helpdesk/messages/read', async (req, res) => {
  const { conversation_id } = req.body;
  if (!conversation_id) return res.status(400).json({ error: 'conversation_id wajib diisi' });
  try { const client = await getMongoClient(); const db = client.db(MONGODB_DB); await db.collection('messages').updateMany({ conversation_id, sender: 'USER', is_read: false }, { $set: { is_read: true } }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Gagal update status pesan', detail: String(err) }); }
});

app.patch('/helpdesk/conversation/close', async (req, res) => {
  const { conversation_id } = req.body;
  if (!conversation_id) return res.status(400).json({ error: 'conversation_id wajib diisi' });
  try { const client = await getMongoClient(); const db = client.db(MONGODB_DB); await db.collection('conversations').updateOne({ conversation_id }, { $set: { status: 'CLOSED', updated_at: new Date() } }); await db.collection('messages').insertOne({ conversation_id, sender: 'SYSTEM', message: 'Percakapan dengan admin telah berakhir.', created_at: new Date(), is_read: true }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Gagal menutup percakapan', detail: String(err) }); }
});

// Health check for Ollama
app.get('/health/ollama', async (req, res) => {
  try { const tags = await getOllamaTags(); const hasModel = !!tags.find(m => m.name === OLLAMA_MODEL); if (!hasModel) return res.status(404).json({ ok: false, error: `Model \"${OLLAMA_MODEL}\" belum ada di Ollama. Jalankan: ollama pull ${OLLAMA_MODEL}`, available: tags.map(m => m.name) }); const out = await generateWithOllama('Balas "OK" jika siap.'); res.json({ ok: true, model: OLLAMA_MODEL, response: out.slice(0,50) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Expose minimal runtime config to frontend (so UI can default the checkbox)
app.get('/faq/config', (req, res) => {
  try {
    res.json({ use_llm_default: USE_LLM_DEFAULT, ollama_url: OLLAMA_URL, ollama_model: OLLAMA_MODEL });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read config', detail: String(e) });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`FAQ backend listening on port ${PORT}`); });

// Admin utility: transcode existing uploaded videos referenced in data/faq.json
// WARNING: this may be slow and requires ffmpeg installed. Restricted endpoint for local admin use.
app.post('/admin/transcode-videos', async (req, res) => {
  try {
    const data = loadFaq();
    const allFaqs = data.flatMap(k => (Array.isArray(k.faq) ? k.faq : []));
    const toProcess = [];
    for (const item of allFaqs) {
      if (!item.videos || !Array.isArray(item.videos)) continue;
      for (const v of item.videos) {
        // if mime is not mp4 or url ends with known non-mp4 extension, schedule
        const url = v.url || v.original_url || '';
        if (!url) continue;
        const ext = path.extname(url).toLowerCase();
        if (ext !== '.mp4') {
          const localPath = path.join(__dirname, 'public', url.replace('/assets/', 'assets/'));
          // Only process local files
          if (localPath.indexOf(UPLOAD_DIR) === 0 && fs.existsSync(localPath)) {
            toProcess.push({ item, video: v, localPath });
          }
        }
      }
    }
    const results = [];
    for (const t of toProcess) {
      try {
        const trans = await transcodeToMp4(t.localPath);
        if (trans && trans.mp4) {
          t.video.original_url = t.video.url;
          t.video.url = trans.mp4;
          if (trans.thumbnail) t.video.thumbnail = trans.thumbnail;
          t.video.mime = 'video/mp4';
          results.push({ ok: true, from: t.localPath, mp4: trans.mp4 });
        } else {
          results.push({ ok: false, from: t.localPath });
        }
      } catch (e) {
        results.push({ ok: false, from: t.localPath, err: String(e) });
      }
    }
    try { saveFaq(data); } catch (_) {}
    res.json({ success: true, processed: results.length, results });
  } catch (e) {
    res.status(500).json({ error: 'Gagal melakukan transcode', detail: String(e) });
  }
});
