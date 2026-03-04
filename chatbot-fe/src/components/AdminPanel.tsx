import { useEffect, useState, useRef } from 'react';
import { Plus, Loader2, CheckCircle, LogOut, Mail, Lock, LogIn } from 'lucide-react';
import { useTheme } from '../theme';
import { addFaq, getCategories, adminLogin, getFaqByCategory, updateFaq } from '../lib/api';

export default function AdminPanel() {
  const { classes } = useTheme();

  const [agent, setAgent] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('admin_agent');
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }
    return null;
  });

  const [formData, setFormData] = useState({
    kategori: '',
    pertanyaan: '',
    jawaban: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [videoLinks, setVideoLinks] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [faqList, setFaqList] = useState<{ index: number; pertanyaan: string; jawaban: string; videos?: any; variasi_pertanyaan?: string[] }[]>([]);
  const [isLoadingFaqList, setIsLoadingFaqList] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [faqSearch, setFaqSearch] = useState('');
  const [isFaqDropdownOpen, setIsFaqDropdownOpen] = useState(false);
  const [variationText, setVariationText] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const cats = await getCategories();
        const sorted = [...cats].sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
        setCategories(sorted);
      } catch (e: any) {
        setErrorMsg(e?.message || 'Gagal memuat kategori');
      }
    })();
  }, []);

  const loadFaqForCategory = async (kategori: string) => {
    if (!kategori) {
      setFaqList([]);
      setEditingIndex(null);
      setVariationText('');
      return;
    }
    setIsLoadingFaqList(true);
    try {
      const items = await getFaqByCategory(kategori);
      setFaqList(items);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Gagal memuat FAQ untuk kategori ini');
      setFaqList([]);
    } finally {
      setIsLoadingFaqList(false);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError(null);
    try {
      const resp = await adminLogin(loginForm.email, loginForm.password);
      if (resp && resp.success) {
        const profile = resp.agent;
        setAgent(profile);
        try {
          localStorage.setItem('admin_agent', JSON.stringify(profile));
        } catch (_) {}
      }
    } catch (err: any) {
      setLoginError(err?.message || 'Login gagal');
    }
  };

  const handleLogout = () => {
    setMenuOpen(false);
    setAgent(null);
    try {
      localStorage.removeItem('admin_agent');
    } catch (_) {}
  };

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent) {
      setErrorMsg('Silakan login terlebih dahulu.');
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);
    try {
      if (editingIndex !== null) {
        const fd = new FormData();
        fd.append('kategori', formData.kategori);
        fd.append('index', String(editingIndex));
        fd.append('pertanyaan', formData.pertanyaan);
        fd.append('jawaban', formData.jawaban);
        fd.append('variasi_pertanyaan', variationText);
        const links = videoLinks.split('\n').map(s => s.trim()).filter(Boolean);
        for (const l of links) fd.append('videos', l);
        for (const f of files) fd.append('videos', f as unknown as Blob, (f as File).name);
        await updateFaq(fd);
        setShowSuccess(true);
        // Setelah update, kosongkan kembali semua input/dropdown edit
        setFormData({ kategori: '', pertanyaan: '', jawaban: '' });
        setFiles([]);
        setVideoLinks('');
        setVariationText('');
        setFaqList([]);
        setEditingIndex(null);
        setFaqSearch('');
        setIsFaqDropdownOpen(false);
      } else {
        if (files && files.length) {
          const fd = new FormData();
          fd.append('kategori', formData.kategori);
          fd.append('pertanyaan', formData.pertanyaan);
          fd.append('jawaban', formData.jawaban);
          fd.append('variasi_pertanyaan', variationText);
          for (const f of files) fd.append('videos', f as unknown as Blob, (f as File).name);
          const links = videoLinks.split('\n').map(s => s.trim()).filter(Boolean);
          for (const l of links) fd.append('videos', l);
          await addFaq(fd);
        } else {
          const links = videoLinks.split('\n').map(s => s.trim()).filter(Boolean);
          const payload: any = {
            kategori: formData.kategori,
            pertanyaan: formData.pertanyaan,
            jawaban: formData.jawaban,
          };
          if (links.length) payload.videos = links;
          await addFaq(payload);
        }
        setShowSuccess(true);
        setFormData({ kategori: '', pertanyaan: '', jawaban: '' });
        setFiles([]);
        setVideoLinks('');
        setVariationText('');
        setFaqList([]);
        setEditingIndex(null);
        setFaqSearch('');
        setIsFaqDropdownOpen(false);
      }
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (e: any) {
      setErrorMsg(e?.message || (editingIndex !== null ? 'Gagal mengupdate FAQ' : 'Gagal menambah FAQ'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    if (name === 'kategori') {
      setEditingIndex(null);
      setFaqSearch('');
      setIsFaqDropdownOpen(false);
      setVideoLinks('');
      setFiles([]);
      setVariationText('');
      loadFaqForCategory(value);
    }
  };

  return (
    <div className="h-full flex flex-col bg-transparent dark:bg-transparent">
      <div className={`${classes.headerBar} px-6 py-4 flex items-center justify-between`}>
        <h2 className="text-white font-semibold text-lg flex items-center gap-2 font-display tracking-tight">
          <Plus className="w-5 h-5" />
          {editingIndex !== null ? 'Edit FAQ' : 'Tambah FAQ Baru'}
        </h2>
        <div>
          {agent ? (
            <div className="flex items-center gap-3">
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="flex items-center gap-3 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white"
                >
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-slate-800 dark:bg-slate-700 dark:text-slate-100 font-medium text-sm">
                    {((agent.fullName || agent.email) || '').charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium">{agent.fullName || agent.email}</span>
                  <LogOut className="w-4 h-4 text-white/90" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-36 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded shadow z-50">
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-slate-100"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-white/80">Admin belum login</div>
          )}
        </div>
      </div>

      {!agent ? (
        <form onSubmit={handleLogin} className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-200 mb-1">Email</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-300">
                <Mail className="w-5 h-5" />
              </span>
              <input
                type="email"
                placeholder="your@email.com"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                className="w-full pl-12 px-3 py-3 rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 text-gray-800 dark:text-slate-100"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-200 mb-1">Password</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-300">
                <Lock className="w-5 h-5" />
              </span>
              <input
                type="password"
                placeholder="••••••••"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="w-full pl-12 px-3 py-3 rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 text-gray-800 dark:text-slate-100"
              />
            </div>
          </div>
          {loginError && <div className="text-sm text-red-600">{loginError}</div>}
          <div>
            <button
              type="submit"
              className={`w-full ${classes.primaryButton} px-4 py-3 rounded flex items-center justify-center gap-2`}
            >
              <LogIn className="w-4 h-4 text-white" />
              <span>Login</span>
            </button>
          </div>
        </form>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2 mt-3">
                Kategori <span className="text-red-500">*</span>
              </label>
              <select
                name="kategori"
                value={formData.kategori}
                onChange={handleChange}
                className={`w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent bg-gray-50 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
                required
              >
                <option value="">Pilih Kategori</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {formData.kategori && (
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                  Pilih FAQ yang akan diedit (opsional)
                </label>
                {isLoadingFaqList ? (
                  <div className="text-sm text-gray-500 dark:text-slate-300">Memuat daftar FAQ...</div>
                ) : faqList.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-slate-300">Belum ada FAQ pada kategori ini.</div>
                ) : (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsFaqDropdownOpen(open => !open)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white/80 dark:bg-slate-900/70 dark:border-slate-700 text-left text-sm flex items-center justify-between gap-2"
                    >
                      <span className="truncate">
                        {(() => {
                          if (editingIndex == null) return '-- Pilih FAQ untuk edit --';
                          const current = faqList.find(f => f.index === editingIndex);
                          if (!current) return '-- Pilih FAQ untuk edit --';
                          const text = current.pertanyaan || '';
                          return text.length > 80 ? text.slice(0, 77) + '...' : text;
                        })()}
                      </span>
                      <span className="text-xs text-gray-400">▼</span>
                    </button>

                    {isFaqDropdownOpen && (
                      <div className="absolute z-40 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg">
                        <div className="p-2 border-b border-gray-200 dark:border-slate-700">
                          <input
                            type="text"
                            value={faqSearch}
                            onChange={(e) => setFaqSearch(e.target.value)}
                            placeholder="Cari pertanyaan..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50 dark:bg-slate-900/70 dark:border-slate-700 dark:text-slate-100 text-sm"
                          />
                        </div>
                        <div className="max-h-64 overflow-auto py-1">
                          {(() => {
                            const keyword = faqSearch.trim().toLowerCase();
                            const filtered = keyword
                              ? faqList.filter(item => item.pertanyaan.toLowerCase().includes(keyword))
                              : faqList;
                            if (!filtered.length) {
                              return (
                                <div className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">
                                  Tidak ada hasil untuk pencarian ini.
                                </div>
                              );
                            }
                            return (
                              <>
                                <button
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                                  onClick={() => {
                                    setEditingIndex(null);
                                    setFormData(prev => ({ ...prev, pertanyaan: '', jawaban: '' }));
                                    setFaqSearch('');
                                    setIsFaqDropdownOpen(false);
                                  }}
                                >
                                  + Tambah FAQ baru (tanpa memilih)
                                </button>
                                {filtered.map(item => (
                                  <button
                                    key={item.index}
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-800"
                                    onClick={() => {
                                      setEditingIndex(item.index);
                                      setFormData(prev => ({
                                        ...prev,
                                        pertanyaan: item.pertanyaan || '',
                                        jawaban: item.jawaban || '',
                                      }));
                                      const vars = (item as any).variasi_pertanyaan;
                                      setVariationText(Array.isArray(vars) ? vars.join('\n') : '');

                                      // Prefill textarea dengan link video yang sudah ada (berdasarkan url)
                                      const vids: any = (item as any).videos;
                                      if (Array.isArray(vids) && vids.length) {
                                        const urls = vids
                                          .map((v: any) => {
                                            if (v == null) return '';
                                            if (typeof v === 'string') return v;
                                            if (typeof v.url === 'string') return v.url;
                                            return '';
                                          })
                                          .map((u: string) => u.trim())
                                          .filter(Boolean);
                                        setVideoLinks(urls.join('\n'));
                                      } else {
                                        setVideoLinks('');
                                      }

                                      setFiles([]);
                                      setIsFaqDropdownOpen(false);
                                    }}
                                  >
                                    {item.pertanyaan}
                                  </button>
                                ))}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                Pertanyaan <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="pertanyaan"
                value={formData.pertanyaan}
                onChange={handleChange}
                placeholder="Contoh: Bagaimana cara tambah barang?"
                className={`w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                Jawaban <span className="text-red-500">*</span>
              </label>
              <textarea
                name="jawaban"
                value={formData.jawaban}
                onChange={handleChange}
                placeholder="Tuliskan jawaban lengkap di sini..."
                rows={6}
                className={`w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent resize-none dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                Variasi Pertanyaan (opsional)
              </label>
              <textarea
                value={variationText}
                onChange={(e) => setVariationText(e.target.value)}
                placeholder={"Satu variasi per baris, contoh:\nBagaimana cara setting nota?\nGimana setting nota?"}
                rows={4}
                className={`w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent resize-none dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Digunakan agar chatbot bisa mengenali beberapa bentuk pertanyaan yang sama.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
                Attach Video (opsional)
              </label>

              {editingIndex !== null && (() => {
                const current = faqList.find(f => f.index === editingIndex) as any;
                const vids = current?.videos as any[] | undefined;
                if (!vids || !vids.length) return null;
                return (
                  <div className="mb-3 rounded-lg border border-dashed border-gray-300 dark:border-slate-700 p-3 bg-gray-50/60 dark:bg-slate-900/40">
                    <div className="text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">
                      Video yang sudah tersimpan
                    </div>
                    <ul className="text-xs text-gray-600 dark:text-slate-300 space-y-1 list-disc list-inside">
                      {vids.map((v, i) => (
                        <li key={i}>
                          {v.source === 'youtube' || (typeof v.url === 'string' && v.url.includes('youtube.com'))
                            ? (v.url || '[YouTube]')
                            : (v.title || v.url || 'Video lokal')}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
                      Jika Anda mengisi link atau upload file baru di bawah ini, daftar video akan diganti dengan yang baru.
                    </p>
                  </div>
                );
              })()}

              <label className="block text-xs font-medium text-gray-700 dark:text-slate-200 mb-1">
                YouTube link (satu per baris)
              </label>
              <textarea
                placeholder={`https://youtu.be/abc123\nhttps://www.youtube.com/watch?v=xyz789`}
                value={videoLinks}
                onChange={(e) => setVideoLinks(e.target.value)}
                rows={3}
                className={`w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent resize-none dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
              />
              <div className="mt-2 text-sm text-gray-700 dark:text-slate-200">Atau unggah file video:</div>
              <div className="mt-1 text-xs text-gray-500">
                Catatan: jika Anda mengunggah file dan juga memasukkan link, keduanya akan disimpan.
                {editingIndex !== null && ' Untuk edit, daftar video lama akan terganti dengan yang baru.'}
              </div>
              <input
                type="file"
                accept="video/*"
                multiple
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
              />
              {files.length > 0 && (
                <div className="mt-2 text-sm text-gray-700 dark:text-slate-200">
                  {files.map((f) => (
                    <div key={f.name}>
                      {f.name} ({Math.round(f.size / 1024)} KB)
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full ${classes.primaryButton} px-6 py-3.5 rounded-xl font-medium focus:outline-none focus:ring-2 ${classes.focusRing} focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {editingIndex !== null ? 'Menyimpan perubahan...' : 'Menambahkan...'}
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5" />
                  {editingIndex !== null ? 'Update FAQ' : 'Tambah FAQ'}
                </>
              )}
            </button>

            {showSuccess && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-xl p-4 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                  {editingIndex !== null ? 'FAQ berhasil diupdate!' : 'FAQ berhasil ditambahkan!'}
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-xl p-4">
                <p className="text-sm text-red-700 dark:text-red-200 font-medium">{errorMsg}</p>
              </div>
            )}

            {showSuccess && (
              <div className="fixed bottom-4 right-4 z-50">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg px-4 py-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm text-gray-800 dark:text-slate-100">Data berhasil disimpan</span>
                </div>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
