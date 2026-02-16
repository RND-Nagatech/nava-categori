import { useEffect, useState } from 'react';
import { Plus, Loader2, CheckCircle } from 'lucide-react';
import { useTheme } from '../theme';
import { addFaq, getCategories } from '../lib/api';

export default function AdminPanel() {
  const { classes } = useTheme();
  const [formData, setFormData] = useState({
    kategori: '',
    pertanyaan: '',
    jawaban: '',
  });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      <div className={`${classes.headerBar} px-6 py-4`}>
        <h2 className="text-white font-semibold text-lg flex items-center gap-2 font-display tracking-tight">
          <Plus className="w-5 h-5" />
          Tambah FAQ Baru
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-0 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-2">
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
    </div>
  );
}
