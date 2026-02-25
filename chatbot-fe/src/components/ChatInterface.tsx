import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, MessageCircle, RotateCcw, ChevronsDown } from 'lucide-react';
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
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('chat_messages');
        if (raw) {
          const parsed = JSON.parse(raw);
          return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
        }
      } catch (_) { /* ignore parse errors */ }
    }
    return [
      {
        id: makeId(),
        type: 'bot',
        text: 'Halo! Saya siap membantu Anda. Pilih kategori dan ajukan pertanyaan.',
        timestamp: new Date(),
      },
    ];
  });
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
  const [lastUserMessageId, setLastUserMessageId] = useState<string | null>(null);
  const [showResetLabel, setShowResetLabel] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isUserNearBottom, setIsUserNearBottom] = useState(true);
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

  async function sendToHelpdesk(question: string, clientMessageId?: string, userId?: string) {
    const resp = await fetch('/helpdesk/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, userId }),
    });
    const data = await resp.json();
    // Jika backend mengembalikan message_id, map temporary client id ke server id
    if (data && data.message_id && clientMessageId) {
      const serverId = String(data.message_id);
      setMessages((prev) => prev.map((m) => m.id === clientMessageId ? { ...m, id: serverId } : m));
      // jika lastUserMessageId mengarah ke temporary id, update juga
      setLastUserMessageId((prevId) => (prevId === clientMessageId ? serverId : prevId));
      console.debug('[ChatInterface] mapped client id to server id', { clientMessageId, serverId });
    }
    // Jika backend memberikan conversation_id (mis. saat membuat/open conversation), simpan ke state + localStorage
    if (data && data.conversation_id) {
      try {
        setConversationId(data.conversation_id);
        if (typeof window !== 'undefined') localStorage.setItem('conversationId', data.conversation_id);
      } catch (_) {}
    }
    return data;
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
    setLastUserMessageId(userMessage.id);
    setShowHelpdeskButton(false);
    // user just submitted a message -> allow auto-scroll to show it
    setIsUserNearBottom(true);
    setMessages((prev) => [...prev, userMessage]);
    setQuestion('');
    setIsLoading(true);
    console.debug('[ChatInterface] handleSubmit', { conversationId, selectedCategory, userMessageId: userMessage.id });

    if (conversationId) {
      try {
        await sendToHelpdesk(userMessage.text, userMessage.id);
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
      console.debug('[ChatInterface] askFaq response', resp);
      const botMessage: Message = {
        id: makeId(),
        type: 'bot',
        text: resp.jawaban || 'Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      const ans = (resp && resp.jawaban) ? String(resp.jawaban).trim().toLowerCase() : '';
      const isNoAnswer = !ans || ans.includes('maaf') && ans.includes('belum ada jawaban');
      setShowHelpdeskButton(Boolean(isNoAnswer));
    } catch (e: any) {
      const botMessage: Message = {
        id: makeId(),
        type: 'bot',
        text: e?.message || 'Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      setShowHelpdeskButton(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleHelpdesk = async () => {
    setShowHelpdeskButton(false);
    setIsLoading(true);
    try {
      const resp = await sendToHelpdesk(lastUserQuestion, lastUserMessageId || undefined);
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
        setMessages((prev) => {
          const backendMsgs: Message[] = msgs.map((m: any): Message => ({
            id: m._id?.$oid || m._id || makeId(),
            type: m.sender === 'ADMIN' || m.sender === 'SYSTEM' ? 'bot' : 'user',
            text: m.message,
            timestamp: new Date(m.created_at),
            is_read: m.is_read,
          }));
          // Merge hanya berdasarkan id
               let merged: Message[] = prev.map((msg: Message) => {
                 const found = backendMsgs.find((bm: Message) => bm.id === msg.id);
                 return found ? { ...msg, is_read: found.is_read } : msg;
               });
               backendMsgs.forEach((bm: Message) => {
                 if (!merged.some((msg: Message) => msg.id === bm.id)) {
                   merged.push({
                     id: bm.id,
                     type: bm.type === 'bot' ? 'bot' : 'user',
                     text: bm.text,
                     timestamp: bm.timestamp,
                     is_read: bm.is_read,
                   });
                 }
               });

              // If backend did NOT include a SYSTEM message when conversation closed,
              // add a local notice so user sees the closed notification. Use
              // resp.conversation.updated_at as timestamp to allow repeated closes.
              if (resp.conversation && String(resp.conversation.status).toUpperCase() === 'CLOSED') {
                const notice = 'Percakapan dengan admin telah selesai. Saya kembali membantu Anda.';
                const hasSystemInResp = msgs.some((m: any) => String(m.sender).toUpperCase() === 'SYSTEM');
                const convUpdated = resp.conversation.updated_at ? new Date(resp.conversation.updated_at) : new Date();
                const existingNoticeIndex = merged.findIndex(m => m.text === notice);

                if (!hasSystemInResp) {
                  if (existingNoticeIndex === -1) {
                    merged.push({ id: makeId(), type: 'bot', text: notice, timestamp: convUpdated });
                  } else {
                    if (merged[existingNoticeIndex].timestamp < convUpdated) {
                      merged.splice(existingNoticeIndex, 1);
                      merged.push({ id: makeId(), type: 'bot', text: notice, timestamp: convUpdated });
                    }
                  }
                }
                console.debug('[ChatInterface] conversation CLOSED processed in poll; hasSystemInResp=', hasSystemInResp);
              }

          return merged;
        });

        // If conversation closed, clear conversationId to route future messages to bot
        if (resp.conversation && String(resp.conversation.status).toUpperCase() === 'CLOSED') {
          console.debug('[ChatInterface] clearing conversationId due to CLOSED status from server', { conversationId: resp.conversation.conversation_id });
          setConversationId(null);
          // Do NOT remove conversationId from localStorage here — keep history for reloads.
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
    if (!isUserNearBottom) return;
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Track user scroll to avoid forcing scroll-to-bottom when user is reading older messages
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const handler = () => {
      const threshold = 120; // px from bottom considered 'near bottom'
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setIsUserNearBottom(atBottom);
    };
    const interactionHandler = () => {
      // user started interacting (pointerdown/wheel/touchstart) — stop auto-scrolling
      setIsUserNearBottom(false);
    };
    el.addEventListener('scroll', handler);
    el.addEventListener('pointerdown', interactionHandler, { passive: true });
    el.addEventListener('wheel', interactionHandler, { passive: true });
    el.addEventListener('touchstart', interactionHandler, { passive: true });
    // initial check
    handler();
    return () => el.removeEventListener('scroll', handler);
  }, [messagesContainerRef.current]);

  // Persist messages to localStorage so reload preserves chat history
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const serializable = messages.map(m => ({ ...m, timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp }));
      localStorage.setItem('chat_messages', JSON.stringify(serializable));
    } catch (_) {}
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
        <div className="ml-2 relative">
          <div>
            <button
              onMouseEnter={() => setShowResetLabel(true)}
              onMouseLeave={() => setShowResetLabel(false)}
              onClick={() => setShowResetConfirm(true)}
              title="Reset Percakapan"
              className="ml-2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            {showResetLabel && (
              <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                Reset
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-0 space-y-4 bg-transparent">
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
        {!isUserNearBottom && (
          <div className="fixed bottom-28 right-6 z-40">
            <button
              onClick={() => {
                if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
                setIsUserNearBottom(true);
              }}
              title="Terbaru"
              aria-label="Terbaru"
              className="bg-blue-600 text-white p-3 rounded-lg shadow-md flex items-center justify-center"
            >
              <ChevronsDown className="w-5 h-5" />
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
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowResetConfirm(false)} />
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 z-10 w-11/12 max-w-md">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-slate-100">Konfirmasi Reset</h3>
            <p className="text-sm text-gray-700 dark:text-slate-300 mb-4">Yakin ingin mereset percakapan? Semua pesan akan dihapus.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowResetConfirm(false)} className="px-4 py-2 rounded bg-gray-200 dark:bg-slate-700">Batal</button>
              <button onClick={() => {
                setShowResetConfirm(false);
                setConversationId(null);
                try { if (typeof window !== 'undefined') { localStorage.removeItem('conversationId'); localStorage.removeItem('chat_messages'); } } catch(_) {}
                setShowHelpdeskButton(false);
                setMessages([
                  { id: makeId(), type: 'bot', text: 'Halo! Saya siap membantu Anda. Pilih kategori dan ajukan pertanyaan.', timestamp: new Date() }
                ]);
              }} className="px-4 py-2 rounded bg-red-600 text-white">Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
