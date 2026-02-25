import { useEffect, useState, useRef } from 'react';
import { Plus, Loader2, CheckCircle, LogOut, Mail, Lock, LogIn } from 'lucide-react';
import { useTheme } from '../theme';
import { addFaq, getCategories, adminLogin } from '../lib/api';

export default function AdminPanel() {
  const { classes } = useTheme();
  const [agent, setAgent] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      try { const raw = localStorage.getItem('admin_agent'); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
    }
    return null;
  });
  const [formData, setFormData] = useState({
    kategori: '',
    pertanyaan: '',
    jawaban: '',
  });
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginError(null);
    try {
      const resp = await adminLogin(loginForm.email, loginForm.password);
      if (resp && resp.success) {
        const profile = resp.agent;
        setAgent(profile);
        try { localStorage.setItem('admin_agent', JSON.stringify(profile)); } catch (_) {}
      }
    } catch (err: any) {
      setLoginError(err?.message || 'Login gagal');
    }
  };

  const handleLogout = () => {
    setMenuOpen(false);
    setAgent(null);
    try { localStorage.removeItem('admin_agent'); } catch (_) {}
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
    if (!agent) { setErrorMsg('Silakan login terlebih dahulu.'); return; }
    setErrorMsg(null);
    setIsLoading(true);
    try {
      await addFaq({
        kategori: formData.kategori,
        pertanyaan: formData.pertanyaan,
        jawaban: formData.jawaban,
      });
      setShowSuccess(true);
      setFormData({ kategori: '', pertanyaan: '', jawaban: '' });
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Gagal menambah FAQ');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="h-full flex flex-col bg-transparent dark:bg-transparent">
      <div className={`${classes.headerBar} px-6 py-4 flex items-center justify-between`}>
        <h2 className="text-white font-semibold text-lg flex items-center gap-2 font-display tracking-tight">
          <Plus className="w-5 h-5" />
          Tambah FAQ Baru
        </h2>
        <div>
          {agent ? (
            <div className="flex items-center gap-3">
              <div ref={menuRef} className="relative">
                <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="flex items-center gap-3 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-slate-800 dark:bg-slate-700 dark:text-slate-100 font-medium text-sm">
                    {((agent.fullName || agent.email) || '').charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium">{agent.fullName || agent.email}</span>
                  <LogOut className="w-4 h-4 text-white/90" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-36 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded shadow z-50">
                    <button onClick={handleLogout} className="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-800 dark:text-slate-100">Logout</button>
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-300"><Mail className="w-5 h-5" /></span>
              <input
                type="email"
                placeholder="your@email.com"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                className={`w-full pl-12 px-3 py-3 rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 text-gray-800 dark:text-slate-100`}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-700 dark:text-slate-200 mb-1">Password</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-300"><Lock className="w-5 h-5" /></span>
              <input
                type="password"
                placeholder="••••••••"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className={`w-full pl-12 px-3 py-3 rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 text-gray-800 dark:text-slate-100`}
              />
            </div>
          </div>
          {loginError && <div className="text-sm text-red-600">{loginError}</div>}
          <div>
            <button type="submit" className={`w-full ${classes.primaryButton} px-4 py-3 rounded flex items-center justify-center gap-2`}>
              <LogIn className="w-4 h-4 text-white" />
              <span>Login</span>
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="p-0 space-y-5">
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
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

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

        {/* Keywords di-hide karena belum dipakai di backend */}

        {/* Payload preview di-hide sementara untuk menyederhanakan UI */}

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full ${classes.primaryButton} px-6 py-3.5 rounded-xl font-medium focus:outline-none focus:ring-2 ${classes.focusRing} focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Menambahkan...
            </>
          ) : (
            <>
              <Plus className="w-5 h-5" />
              Tambah FAQ
            </>
          )}
        </button>

        {showSuccess && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-800 dark:text-green-200 font-medium">
              FAQ berhasil ditambahkan!
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
      )}
    </div>
  );
}
