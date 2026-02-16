import { useTheme } from '../theme';

const FREEPIK_URL = 'https://www.freepik.com/free-vector/call-center-isometric-concept_26761063.htm#fromView=search&page=1&position=15&uuid=b46e44cc-458f-4373-b7cf-11a68aeede2a&query=chatbot';

export default function IllustrationPanel() {
  const { classes } = useTheme();
  // Default ke '/aset.jpg' di Vite public folder jika env tidak di-set
  const envAny = (import.meta as any)?.env || {};
  const baseSrc = envAny.VITE_ILLUSTRATION_IMG || '/aset.jpg';
  // Versi untuk cache-busting: bisa di-set via .env, atau otomatis pakai timestamp saat DEV
  const version = envAny.VITE_ILLUSTRATION_VERSION || (envAny.DEV ? Date.now().toString() : '');
  const imgSrc = version ? `${baseSrc}?v=${version}` : baseSrc;

  return (
    <div className="w-full h-full">
      {imgSrc ? (
        <div className="relative w-full h-full">
          <img src={imgSrc} alt="Ilustrasi chatbot" className="w-full h-full object-cover" />
          {/* Theme-tinted overlay so background adapts to selected color */}
          <div className={`absolute inset-0 ${classes.headerBar} opacity-10 dark:opacity-20 mix-blend-multiply`} />
          {/* Soft white lift so the image feels brighter and cleaner */}
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-white/10 to-transparent dark:from-white/10 dark:via-white/5 dark:to-transparent mix-blend-screen" />
        </div>
      ) : (
        <a href={FREEPIK_URL} target="_blank" rel="noreferrer" className="block w-full h-full">
          <div className="relative w-full h-full overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-100 via-yellow-100 to-white dark:from-slate-800 dark:via-slate-900 dark:to-slate-800" />
          </div>
          <p className="sr-only">Ilustrasi oleh Freepik — klik untuk membuka sumber.</p>
        </a>
      )}
    </div>
  );
}
