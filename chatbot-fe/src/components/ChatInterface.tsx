import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, MessageCircle, RotateCcw } from 'lucide-react';
import { askFaq, getCategories, getHelpdeskMessages } from '../lib/api';

// Type definition for a chat message
export type Message = {
  id: string;
  type: 'user' | 'bot';
  text: string;
  timestamp: Date;
  is_read?: boolean;
};

function makeId() {
  return Math.random().toString(36).substr(2, 9);
}

export default function ChatInterface() {
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: makeId(),
      type: 'bot',
      text: 'Halo! Saya siap membantu Anda. Pilih kategori dan ajukan pertanyaan.',
      timestamp: new Date(),
    },
  ]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showHelpdeskButton, setShowHelpdeskButton] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('conversationId');
    }
    return null;
  });
  const [useLLM, setUseLLM] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('useLLM');
      if (v !== null) return v === '1';
    }
    return false;
  });
  const [lastUserQuestion, setLastUserQuestion] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const cats = await getCategories();
        const uniqueCats = Array.from(new Set(cats));
        const sorted = [...uniqueCats].sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
        setCategories(sorted);
      } catch (e: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            type: 'bot',
            text: `Gagal memuat kategori: ${e?.message || 'unknown error'}`,
            timestamp: new Date(),
          },
        ]);
      }
      // Fetch server config for LLM default if frontend hasn't stored preference
      try {
        if (typeof window !== 'undefined' && localStorage.getItem('useLLM') === null) {
          const cfg = await fetch('/faq/config').then(r => r.json()).catch(() => null);
          if (cfg && typeof cfg.use_llm_default === 'boolean') {
            setUseLLM(cfg.use_llm_default);
          }
        }
      } catch (_) { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendToHelpdesk(question: string, userId?: string) {
    const resp = await fetch('/helpdesk/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, userId }),
    });
    return await resp.json();
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !selectedCategory) return;

    const userMessage: Message = {
      id: makeId(),
      type: 'user',
      text: question,
      timestamp: new Date(),
    };

    setLastUserQuestion(question);
    setShowHelpdeskButton(false);
    setMessages((prev) => [...prev, userMessage]);
    setQuestion('');
    setIsLoading(true);

    if (conversationId) {
      try {
        await sendToHelpdesk(userMessage.text);
      } catch {
        setMessages((prev) => [...prev, {
          id: makeId(),
          type: 'bot',
          text: 'Gagal mengirim ke helpdesk.',
          timestamp: new Date(),
        }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    try {
      const resp = await askFaq({ kategori: selectedCategory, pertanyaan: userMessage.text, use_llm: useLLM });
      const botMessage: Message = {
        id: makeId(),
        type: 'bot',
        text: resp.jawaban || 'Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      if ((!resp.jawaban || resp.jawaban.includes('Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain')) && !conversationId) {
        setShowHelpdeskButton(true);
      } else {
        setShowHelpdeskButton(false);
      }
    } catch (e: any) {
      const botMessage: Message = {
        id: makeId(),
        type: 'bot',
        text: e?.message || 'Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      if (!conversationId) setShowHelpdeskButton(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleHelpdesk = async () => {
    setShowHelpdeskButton(false);
    setIsLoading(true);
    try {
      const resp = await sendToHelpdesk(lastUserQuestion);
      setMessages((prev) => [...prev, {
        id: makeId(),
        type: 'bot',
        text: resp.success ? 'Pertanyaan Anda telah dikirim ke helpdesk.' : 'Gagal mengirim ke helpdesk.',
        timestamp: new Date(),
      }]);
      if (resp.success && resp.conversation_id) {
        setConversationId(resp.conversation_id);
        if (typeof window !== 'undefined') {
          localStorage.setItem('conversationId', resp.conversation_id);
        }
        setShowHelpdeskButton(false);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: makeId(),
        type: 'bot',
        text: 'Gagal mengirim ke helpdesk.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const resp = await getHelpdeskMessages(conversationId);
        const msgs = resp.messages || [];
        const conv = resp.conversation || null;
        setMessages((prev) => {
          const backendMsgs: Message[] = msgs.map((m: any): Message => ({
            id: m._id?.$oid || m._id || makeId(),
            type: m.sender === 'ADMIN' || m.sender === 'SYSTEM' ? 'bot' : 'user',
            text: m.message,
            timestamp: new Date(m.created_at),
            is_read: m.is_read,
          }));
          const merged: Message[] = prev.map((msg: Message) => {
            const found = backendMsgs.find((bm: Message) => bm.id === msg.id || bm.text === msg.text);
            return found ? { ...msg, is_read: found.is_read } : msg;
          });
          backendMsgs.forEach((bm: Message) => {
            if (!merged.some((msg: Message) => msg.id === bm.id || msg.text === bm.text)) {
              merged.push({
                id: bm.id,
                type: bm.type === 'bot' ? 'bot' : 'user',
                text: bm.text,
                timestamp: bm.timestamp,
                is_read: bm.is_read,
              });
            }
          });

          // If conversation closed by admin, notify user and clear conversationId so subsequent messages go to bot
          if (conv && conv.status && String(conv.status).toUpperCase() === 'CLOSED') {
            const notice = 'Percakapan dengan admin telah selesai. Saya kembali membantu Anda.';
            if (!merged.some(m => m.text === notice)) {
              merged.push({ id: makeId(), type: 'bot', text: notice, timestamp: new Date() });
            }
          }

          return merged;
        });

        // If conversation closed, clear conversationId to route future messages to bot
        if (resp.conversation && String(resp.conversation.status).toUpperCase() === 'CLOSED') {
          setConversationId(null);
          localStorage.removeItem('conversationId');
          setShowHelpdeskButton(false);
          // stop further polling
          if (pollingRef.current) clearTimeout(pollingRef.current);
          return;
        }
      } catch {}
      if (!stopped) {
        pollingRef.current = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      stopped = true;
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [conversationId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const classes = {
    headerBar: 'bg-blue-700 dark:bg-slate-900',
    userBubble: 'bg-blue-600 text-white shadow-md border border-blue-200 dark:bg-blue-700 dark:border-blue-900',
    loaderColor: 'text-blue-600 dark:text-blue-400',
    focusRing: 'ring-blue-600 dark:ring-blue-400',
    primaryButton: 'bg-blue-600 text-white hover:bg-blue-700',
    checkboxColor: 'accent-blue-600 dark:accent-blue-400',
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-transparent dark:bg-transparent">
      <div className={`${classes.headerBar} px-6 py-4 flex items-center justify-between`}>
        <h2 className="text-white font-semibold text-lg flex items-center gap-2 font-display tracking-tight">
          <MessageCircle className="w-5 h-5" />
          Chat Assistant
        </h2>
        <button
          onClick={() => {
            setConversationId(null);
            localStorage.removeItem('conversationId');
            setShowHelpdeskButton(false);
            setMessages([
              {
                id: makeId(),
                type: 'bot',
                text: 'Halo! Saya siap membantu Anda. Pilih kategori dan ajukan pertanyaan.',
                timestamp: new Date(),
              },
            ]);
          }}
          title="Reset Percakapan"
          className="ml-2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
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
              style={message.type === 'user' ? { position: 'relative' } : {}}
            >
              <p className="text-sm leading-relaxed">{message.text}</p>
              <div className="flex items-center gap-1">
                <div className="flex items-center justify-end mt-1 gap-1">
                  <p
                    className={`text-xs ${
                      message.type === 'user' ? 'text-white/70' : 'text-gray-400 dark:text-slate-400'
                    }`}
                    style={{ marginRight: message.type === 'user' ? 0 : 0 }}
                  >
                    {message.timestamp.toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {/* Centang 1/2 WhatsApp style, pojok kanan bawah bubble */}
                  {message.type === 'user' && (
                    <span
                      title={message.is_read ? 'Sudah dibaca admin' : 'Terkirim'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        position: 'absolute',
                        right: 2,
                        bottom: 8,
                        zIndex: 2,
                      }}
                    >
                      {message.is_read ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <path d="M7 13.5L10.5 17L19 8.5" stroke="#d1d5db" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M5 14.5L8.5 18L17 9.5" stroke="#d1d5db" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }} />
                        </svg>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <path d="M7 13.5L10.5 17L19 8.5" stroke="#d1d5db" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  )}
                </div>
              </div>
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
        {showHelpdeskButton && !conversationId && (
          <div className="flex justify-center mt-2">
            <button
              onClick={handleHelpdesk}
              className="bg-blue-600 text-white px-6 py-2 rounded-xl font-medium shadow-md hover:bg-blue-700 transition-all"
              disabled={isLoading}
            >
              Ajukan ke Helpdesk
            </button>
          </div>
        )}
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
                onChange={(e) => {
                  const v = e.target.checked;
                  setUseLLM(v);
                  if (typeof window !== 'undefined') localStorage.setItem('useLLM', v ? '1' : '0');
                }}
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
