import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, MessageCircle } from 'lucide-react';
import { useTheme } from '../theme';
import { askFaq, getCategories } from '../lib/api';

interface Message {
  id: string;
  type: 'user' | 'bot';
  text: string;
  timestamp: Date;
}

export default function ChatInterface() {
  const { classes } = useTheme();
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [useLLM, setUseLLM] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  const makeId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      // @ts-ignore
      return crypto.randomUUID();
    }
    const id = `${Date.now()}-${idCounter.current++}`;
    return id;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setMessages([
      {
        id: '1',
        type: 'bot',
        text: 'Halo! Saya siap membantu Anda. Pilih kategori dan ajukan pertanyaan.',
        timestamp: new Date(),
      },
    ]);
    // Load categories from backend
    (async () => {
      try {
        const cats = await getCategories();
        const sorted = [...cats].sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
        setCategories(sorted);
      } catch (e: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            type: 'bot',
            text: `Gagal memuat kategori: ${e?.message || 'unknown error'}`,
            timestamp: new Date(),
          },
        ]);
      }
    })();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !selectedCategory) return;

    const userMessage: Message = {
      id: makeId(),
      type: 'user',
      text: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion('');
    setIsLoading(true);
    try {
      const resp = await askFaq({ kategori: selectedCategory, pertanyaan: userMessage.text, use_llm: useLLM });
      const botMessage: Message = {
        id: makeId(),
        type: 'bot',
        text: resp.jawaban || 'Maaf, belum ada jawaban.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } catch (e: any) {
      const botMessage: Message = {
        id: makeId(),
        type: 'bot',
        text: e?.message || 'Maaf, belum ada jawaban.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-transparent dark:bg-transparent">
      <div className={`${classes.headerBar} px-6 py-4`}>
        <h2 className="text-white font-semibold text-lg flex items-center gap-2 font-display tracking-tight">
          <MessageCircle className="w-5 h-5" />
          Chat Assistant
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-0 space-y-4 bg-transparent">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                message.type === 'user'
                  ? classes.userBubble
                  : 'bg-white text-gray-800 shadow-sm border border-gray-100 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700'
              }`}
            >
              <p className="text-sm leading-relaxed">{message.text}</p>
              <p
                className={`text-xs mt-1 ${
                  message.type === 'user' ? 'text-white/70' : 'text-gray-400 dark:text-slate-400'
                }`}
              >
                {message.timestamp.toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-100 rounded-2xl px-4 py-3 shadow-sm border border-gray-100 dark:border-slate-700">
              <Loader2 className={`w-5 h-5 animate-spin ${classes.loaderColor}`} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-0 bg-transparent border-t-0">
        <div className="space-y-4">
          <div className="flex gap-3">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className={`flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent bg-gray-50 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
              required
            >
              <option value="">Pilih Kategori</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
              <input
                type="checkbox"
                checked={useLLM}
                onChange={(e) => setUseLLM(e.target.checked)}
                className={`w-4 h-4 rounded ${classes.checkboxColor}`}
              />
              <span className="text-sm text-gray-700 dark:text-slate-200 font-medium">Use LLM</span>
            </label>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ketik pertanyaan Anda di sini..."
              className={`flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${classes.focusRing} focus:border-transparent dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
              required
            />
            <button
              type="submit"
              disabled={isLoading || !selectedCategory}
              className={`${classes.primaryButton} px-6 py-3 rounded-xl font-medium focus:outline-none focus:ring-2 ${classes.focusRing} focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg`}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
