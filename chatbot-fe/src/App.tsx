import { useState } from 'react';
import ChatInterface from './components/ChatInterface';
import AdminPanel from './components/AdminPanel';
import IllustrationPanel from './components/IllustrationPanel';
import { Coins, Moon, Sun } from 'lucide-react';
import { ThemeProvider, useTheme, getAvailableThemes } from './theme';

function HeaderControls() {
  const { theme, setTheme, dark, toggleDark } = useTheme();
  const themes = getAvailableThemes();
  const swatchMap: Record<string, string> = {
    amber: 'from-amber-500 to-yellow-500',
    blue: 'from-blue-500 to-cyan-500',
    purple: 'from-violet-500 to-fuchsia-500',
  };
  return (
    <div className="flex items-center gap-1 bg-white/60 dark:bg-slate-900/50 backdrop-blur-md border border-gray-200 dark:border-slate-700 rounded-md px-1 py-0 shadow-sm">
      <button
        onClick={toggleDark}
        aria-label="Toggle dark mode"
        className="px-1 py-0.5 rounded text-gray-700 hover:bg-gray-50 transition-colors dark:text-slate-200 dark:hover:bg-slate-800"
        title={dark ? 'Switch to Light' : 'Switch to Dark'}
      >
        {dark ? <Sun className="w-[14px] h-[14px]" /> : <Moon className="w-[14px] h-[14px]" />}
      </button>
      <div className="flex items-center gap-1 pl-1">
        {themes.map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t as any)}
            aria-label={`Pilih tema ${t}`}
            title={`Tema ${t}`}
            className={`w-[14px] h-[14px] rounded-sm bg-gradient-to-r ${swatchMap[t]} ring-1 ring-black/10 focus:outline-none ${
              theme === t
                ? 'ring-2 ring-black/30 dark:ring-white/40'
                : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function AppInner() {
  const [activeTab, setActiveTab] = useState<'chat' | 'admin'>('chat');
  const { classes } = useTheme();

  return (
    <div className="h-screen min-h-0 relative flex flex-col">
      <div className="flex-1 w-screen h-full px-0 py-0 flex flex-col">
        <div className="fixed right-2 top-2 md:right-3 md:top-3 z-50">
          <HeaderControls />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-0 items-stretch flex-1 min-h-0 overflow-hidden">
          {/* Left illustration (hidden on small screens) */}
          <div className="hidden md:block h-full">
            <IllustrationPanel />
          </div>
          {/* Right content: Chat or Admin */}
          <div className="h-full min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 w-full md:w-[92%] lg:w-[88%] xl:w-[84%] mx-auto flex flex-col">
              <header className="relative text-center mb-3 pt-2">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div className={`${classes.brandIconBg} p-3 rounded-2xl shadow-lg flex items-center justify-center shrink-0`}>
                    <Coins className="w-8 h-8 text-white translate-y-[4px]" />
                  </div>
                  <h1 className={`text-3xl md:text-4xl font-bold tracking-tight leading-none font-display ${classes.titleTextGradient}`}>
                    NAVA CARE
                  </h1>
                </div>
              </header>

              <div className="px-6 mb-3">
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'chat'
                        ? classes.tabActiveBtn
                        : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    onClick={() => setActiveTab('admin')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'admin'
                        ? classes.tabActiveBtn
                        : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700'
                    }`}
                  >
                    Admin Panel
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {activeTab === 'chat' ? <ChatInterface /> : <AdminPanel />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
