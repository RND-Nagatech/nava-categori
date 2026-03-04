// Ambil semua pesan helpdesk untuk conversation tertentu
export async function getHelpdeskMessages(conversation_id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/helpdesk/messages?conversation_id=${encodeURIComponent(conversation_id)}`);
  if (!res.ok) throw new Error('Gagal mengambil pesan helpdesk');
  const data = await res.json();
  // returns { messages: [...], conversation: { conversation_id, status, updated_at } }
  return data;
}
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
const API_BASE = (() => {
  const envBase = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL;
  if (envBase && envBase.trim()) return envBase;
  // Always use path relative for dev, so Vite proxy works
  return '';
})();

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

export async function addFaq(payload: AddPayload | FormData): Promise<{ success: boolean; message: string }>{
  let res: Response;
  if (typeof FormData !== 'undefined' && payload instanceof FormData) {
    res = await fetch(`${API_BASE}/faq/add`, { method: 'POST', body: payload });
  } else {
    res = await fetch(`${API_BASE}/faq/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Gagal menambah FAQ (${res.status})`);
  }
  return data;
}

export async function adminLogin(email: string, password: string): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Login gagal (${res.status})`);
  return data;
}
