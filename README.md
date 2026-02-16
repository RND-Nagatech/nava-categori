# NavaCare FAQ Semantic Backend

Catatan singkat, jelas, dan padat untuk membangun FE yang terintegrasi dengan backend ini.

## Ringkasan Arsitektur
- **Embedding Service (Python)**: Layanan di port 5001 untuk menghasilkan embedding pertanyaan. Bisa pakai SentenceTransformer lokal atau Ollama.
- **Qdrant (Vector DB)**: Menyimpan index embedding di port 6333.
- **FAQ Backend (Node/Express)**: API di port 3000 untuk kategori, tambah FAQ, dan penjawaban berbasis pencarian semantik + aturan.
- **Sumber data**: data/faq.json berisi daftar kategori dan FAQ.

## Alur Kerja
1. FE ambil daftar kategori dari backend.
2. User pilih kategori dan masukkan pertanyaan.
3. FE panggil endpoint tanya jawab; backend akan melakukan:
   - Normalisasi + fuzzy match lokal,
   - Jika perlu: panggil Embedding Service → cari ke Qdrant,
   - Opsional: minta LLM (Ollama) untuk merumuskan jawaban akhir.

## Menjalankan Layanan
Pastikan Python venv dan Node dependencies sudah siap.

```bash
# 1) Install dependencies
python -m pip install -U flask requests sentence-transformers qdrant-client tqdm pandas
npm install

# 2) Jalankan Embedding Service (pilih salah satu)
# Menggunakan SentenceTransformer lokal
npm run embed:service:st
# Menggunakan Ollama embeddings
npm run embed:service:ollama
# Catatan env:
#   USE_OLLAMA_EMBED=1 untuk Ollama, OLLAMA_EMBED_MODEL=nomic-embed-text default
#   OLLAMA_URL default http://127.0.0.1:11434

# 3) Buat/refresh index Qdrant (sesuaikan dengan pilihan embed di langkah 2)
# Menggunakan SentenceTransformer lokal
npm run embed:index:st
# Menggunakan Ollama embeddings
npm run embed:index:ollama

# 4) Jalankan FAQ Backend (Express)
# Default model Ollama untuk LLM: qwen3:1.7b
npm run start
# atau
npm run start:qwen
```

Prasyarat tambahan:
- **Ollama**: `ollama serve` dan `ollama pull qwen3:1.7b` (untuk LLM), `ollama pull nomic-embed-text` (untuk embeddings kalau pakai Ollama).
- **Qdrant**: jalankan lokal di `http://localhost:6333`.

## Variabel Lingkungan Penting
- Backend Node:
  - `OLLAMA_URL` (default `http://localhost:11434`)
  - `OLLAMA_MODEL` (default `qwen3:1.7b`)
  - `USE_LLM` (set `1` untuk mengaktifkan jawaban LLM bila perlu)
  - `PORT` (default `3000`)
- Embedding Service (Python):
  - `USE_OLLAMA_EMBED` (`1` untuk Ollama, `0` untuk SentenceTransformer lokal)
  - `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`)
  - `OLLAMA_URL` (default `http://127.0.0.1:11434`)

- Frontend (Vite):
  - File env di FE ada di `chatbot-fe/.env` (di-ignore Git)
  - Template: `chatbot-fe/.env.sample` → copy menjadi `.env`
  - Variabel yang dipakai: `VITE_API_BASE_URL`, `VITE_ILLUSTRATION_IMG`, `VITE_ILLUSTRATION_VERSION`

## Spesifikasi API Backend (untuk FE)
Base URL: `http://localhost:3000`

- GET `/faq/categories`
  - Respon: `string[]` daftar kategori.

- POST `/faq/add`
  - Body: `{ "kategori": string, "pertanyaan": string, "jawaban": string }`
  - Respon: `{ "success": true, "message": string }` atau error 4xx.

- POST `/faq/ask`
  - Body: `{ "kategori": string, "pertanyaan": string, "use_llm"?: boolean }`
  - Query alternatif: `?llm=1` untuk memaksa pakai LLM.
  - Respon sukses: `{ "pertanyaan": string, "score": number, "jawaban": string, "mode"?: string }`
    - `mode` (opsional) bisa berupa `exact`, `local-fuzzy`, `rule`, `llm`, `fallback`, dll.
  - Respon gagal: `{ "error": string }` (404 bila tidak ditemukan atau belum ada jawaban).

- GET `/health/ollama`
  - Cek kesiapan Ollama dan ketersediaan model.
  - Respon: `{ ok: boolean, model?: string, response?: string, error?: string, available?: string[] }`

## Format Data FAQ
File: data/faq.json
```json
[
  {
    "kategori": "Penjualan",
    "faq": [
      { "pertanyaan": "Apa itu margin penjualan?", "jawaban": "Margin penjualan adalah..." }
    ]
  }
]
```

## Alur di FE (disarankan)
- Ambil kategori → tampilkan dropdown.
- Saat submit: panggil `/faq/ask` dengan `{ kategori, pertanyaan, use_llm? }`.
- Tampilkan `jawaban` dari respons. Bila error 404, tampilkan pesan "Maaf, belum ada jawaban.".
- Endpoint `/faq/add` bisa dipakai untuk menambah FAQ baru (admin/privileged flow).

## Contoh Request (cURL)
```bash
# Ambil kategori
curl -s http://localhost:3000/faq/categories

# Bertanya
curl -s -X POST http://localhost:3000/faq/ask \
  -H 'Content-Type: application/json' \
  -d '{ "kategori": "Penjualan", "pertanyaan": "Laporan penjualan margin buat apa?" }'

# Tambah FAQ
curl -s -X POST http://localhost:3000/faq/add \
  -H 'Content-Type: application/json' \
  -d '{ "kategori": "Penjualan", "pertanyaan": "Bagaimana melihat informasi stok?", "jawaban": "Menu stok menampilkan..." }'

# Health check Ollama
curl -s http://localhost:3000/health/ollama
```

## Troubleshooting Cepat
- 400 dari Qdrant saat search: kemungkinan dimensi embedding mismatch → pastikan Embedding Service (mode ST/Ollama) sama dengan saat indexing, lalu re-run langkah index.
- Tidak ada jawaban atau error koneksi Ollama: cek `/health/ollama`, pastikan `ollama serve` dan model sudah di-pull.
- Pastikan Embedding Service berjalan sebelum backend melakukan pencarian semantik.

## Lokasi File Penting
- Backend: faq_backend.js
- Endpoint tanya (varian sederhana): faq_ask_endpoint.js
- Embedding Service (Python): embedding_service.py
- Indexer Qdrant: embed_and_index_qdrant.py
- Konversi Excel → JSON: convert_excel_to_json.py
- Data: data/faq.json
