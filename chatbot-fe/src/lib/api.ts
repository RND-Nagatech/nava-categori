export type AskPayload = {
  kategori: string;
  pertanyaan: string;
  use_llm?: boolean;
};

export type AskResponse = {
  pertanyaan: string;
  score: number;
  jawaban: string;
  mode?: string;
};

export type AddPayload = {
  kategori: string;
  pertanyaan: string;
  jawaban: string;
};

// Resolusi base URL:
// - Jika VITE_API_BASE_URL di-set, gunakan itu (contoh: http://localhost:3000)
// - Jika tidak di-set dan sedang dev (Vite), gunakan path relatif untuk memanfaatkan proxy Vite
// - Fallback ke http://localhost:3000
const API_BASE =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ??
  (typeof window !== 'undefined' && window.location && window.location.port ? '' : 'http://localhost:3000');

export async function getCategories(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/faq/categories`);
  if (!res.ok) throw new Error(`Gagal memuat kategori (${res.status})`);
  return res.json();
}

export async function askFaq(payload: AskPayload): Promise<AskResponse> {
  const res = await fetch(`${API_BASE}/faq/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 404) {
    const err = await res.json().catch(() => ({ error: 'Maaf, belum ada jawaban.' }));
    throw new Error(err.error || 'Maaf, belum ada jawaban.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal memproses pertanyaan (${res.status})`);
  }
  return res.json();
}

export async function addFaq(payload: AddPayload): Promise<{ success: boolean; message: string }>{
  const res = await fetch(`${API_BASE}/faq/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Gagal menambah FAQ (${res.status})`);
  }
  return data;
}
