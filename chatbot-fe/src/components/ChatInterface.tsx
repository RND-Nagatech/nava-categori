import { useState, useEffect, useRef } from 'react';
import { Send, Loader2, MessageCircle, RotateCcw, ChevronsDown } from 'lucide-react';
import { askFaq, getCategories, getHelpdeskMessages } from '../lib/api';
import { useTheme } from '../theme';

// Type definition for a chat message
export type Message = {
  id: string;
  type: 'user' | 'bot';
  text: string;
  timestamp: Date;
  is_read?: boolean;
  videos?: Array<{ title?: string; url: string; thumbnail?: string | null; mime?: string; source?: string; size?: number }>;
};

function makeId() {
  return Math.random().toString(36).substr(2, 9);
}

export default function ChatInterface() {
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryContainerRef = useRef<HTMLDivElement | null>(null);
  const [dropdownUp, setDropdownUp] = useState(false);
  // initialize messages in a separate function to avoid TSX generic parsing ambiguity
  const initMessages = (): Message[] => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('chat_messages');
        if (raw) {
          const parsed = JSON.parse(raw);
          // normalize any escaped newlines stored in cached messages so they render as real line breaks
          return parsed.map((m: any) => {
            const txt = typeof m.text === 'string'
              ? String(m.text).replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\n').replace(/\\r/g, '\\n')
              : m.text;
            return { ...m, text: txt, timestamp: new Date(m.timestamp) };
          });
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
  };

  const [messages, setMessages] = useState<Message[]>(initMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [question, setQuestion] = useState('');
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
  const [userName, setUserName] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('helpdesk_user_name');
    return null;
  });
  const [showNameEdit, setShowNameEdit] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const existing = localStorage.getItem('helpdesk_user_name');
      return !existing; // show modal if no name saved
    }
    return false;
  });
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [showNameRequiredNotice, setShowNameRequiredNotice] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isUserNearBottom, setIsUserNearBottom] = useState(true);
  const [videoErrorMap, setVideoErrorMap] = useState<Record<string, boolean>>({});
  const pollingRef = useRef<any>(null);
  const [modalVideo, setModalVideo] = useState<any | null>(null);

  const openVideoModal = (v: any) => {
    try { setModalVideo(v); } catch (_) { setModalVideo(v); }
  };
  const closeVideoModal = () => setModalVideo(null);

  // close modal on Escape
  useEffect(() => {
    if (!modalVideo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeVideoModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalVideo]);
  
  // Close dropdown on outside click and decide open direction
  useEffect(() => {
    if (!showCategoryDropdown) return;
    function handleOutside(e: MouseEvent) {
      const el = categoryContainerRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setShowCategoryDropdown(false);
      }
    }
    function decideDirection() {
      try {
        const el = categoryContainerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        // approximate dropdown height (max 240px)
        const dropdownH = Math.min(240, (categories.length || 6) * 40);
        if (spaceBelow < dropdownH && spaceAbove > spaceBelow) setDropdownUp(true); else setDropdownUp(false);
      } catch (_) { setDropdownUp(false); }
    }
    decideDirection();
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('resize', decideDirection);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('resize', decideDirection);
    };
  }, [showCategoryDropdown, categories]);

  // autofocus name input when name modal opens
  useEffect(() => {
    if (showNameEdit && nameInputRef.current) {
      try { setTimeout(() => { nameInputRef.current?.focus(); }, 50); } catch (_) {}
    }
  }, [showNameEdit]);

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
    const body: any = { question };
    if (userId) body.userId = userId;
    if (userName) body.user_name = userName;
    const resp = await fetch('/helpdesk/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

    // helper to push bot response which may contain jawaban_lines
    const pushBotResponse = (resp: any) => {
      try {
        let pushedTextId: string | null = null;
        if (resp && Array.isArray(resp.jawaban_lines) && resp.jawaban_lines.length) {
          // join lines into a single text with newlines so it renders in one bubble
          const joined = resp.jawaban_lines.join('\n');
          const msg = { id: makeId(), type: 'bot', text: joined, timestamp: new Date() } as Message;
          setMessages((prev) => [...prev, msg]);
          pushedTextId = msg.id;
        } else {
          const text = (resp && (resp.jawaban || resp.answer)) ? String(resp.jawaban || resp.answer) : 'Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain';
          const msg = { id: makeId(), type: 'bot', text, timestamp: new Date() } as Message;
          setMessages((prev) => [...prev, msg]);
          pushedTextId = msg.id;
        }

        // if there are videos attached, push a separate message containing video metadata
        if (resp && Array.isArray(resp.videos) && resp.videos.length) {
          const vmsg = { id: makeId(), type: 'bot', text: '', timestamp: new Date(), videos: resp.videos } as Message;
          setMessages((prev) => [...prev, vmsg]);
        }
      } catch (e) {
        setMessages((prev) => [...prev, { id: makeId(), type: 'bot', text: 'Maaf, belum ada jawaban.', timestamp: new Date() }]);
      }
    };

    if (conversationId) {
      const userIdToSend = userName || undefined;
      // If user hasn't set a name yet, prompt them and do NOT forward to helpdesk,
      // but still process the question through the FAQ flow so the bot replies.
      if (!userName) {
        setShowNameEdit(true);
        setShowNameRequiredNotice(true);
        // fallback to FAQ answer so user sees an immediate reply
        try {
          const resp = await askFaq({ kategori: selectedCategory, pertanyaan: userMessage.text, use_llm: useLLM });
          await pushBotResponse(resp);
          const ans = (resp && resp.jawaban) ? String(resp.jawaban).trim().toLowerCase() : '';
          const isNoAnswer = !ans || (ans.includes('maaf') && ans.includes('belum ada jawaban'));
          setShowHelpdeskButton(Boolean(isNoAnswer));
        } catch (e: any) {
          setMessages((prev) => [...prev, {
            id: makeId(),
            type: 'bot',
            text: e?.message || 'Maaf, belum ada jawaban. Silakan ajukan pertanyaan lebih spesifik atau pilih kategori lain',
            timestamp: new Date(),
          }]);
          setShowHelpdeskButton(true);
        } finally {
          setIsLoading(false);
          setTimeout(() => setShowNameRequiredNotice(false), 5000);
        }
        return;
      }
      try {
        await sendToHelpdesk(userMessage.text, userMessage.id, userIdToSend);
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
      await pushBotResponse(resp);
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
    // Ensure user has a name before sending to helpdesk
    if (!userName) {
      setShowNameEdit(true);
      setShowNameRequiredNotice(true);
      setTimeout(() => setShowNameRequiredNotice(false), 5000);
      return;
    }

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
        // If user is already near bottom right before we merge new backend messages,
        // allow auto-scroll so incoming messages are visible. Don't force-scroll
        // when the user intentionally scrolled up.
        try {
          const el = messagesContainerRef.current;
          const threshold = 120;
          if (el) {
            const atBottomNow = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
            if (atBottomNow) setIsUserNearBottom(true);
          }
        } catch (_) {}

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
                const notice = 'Percakapan dengan admin telah berakhir. Saya kembali membantu Anda.';
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

  const { classes: themeClasses } = useTheme();
  // Detect backend origin (try common dev ports) so assets point at the correct server (3000/3001)
  const [backendOrigin, setBackendOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const host = window.location.hostname || 'localhost';
    const proto = window.location.protocol || 'http:';
    const candidates = [3000, 3001, 3002];

    const probe = async () => {
      for (const p of candidates) {
        const url = `${proto}//${host}:${p}/faq/config`;
        try {
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 1500);
          const r = await fetch(url, { method: 'GET', signal: ctrl.signal });
          clearTimeout(timeout);
          if (!cancelled && r.ok) {
            setBackendOrigin(`${proto}//${host}:${p}`);
            return;
          }
        } catch (_) {
          /* ignore and try next port */
        }
      }
      // fallback to same origin
      if (!cancelled) setBackendOrigin(window.location.origin);
    };
    probe();
    return () => { cancelled = true; };
  }, []);

  // Resolve an asset URL (like `/assets/videos/foo.mov`) to the backend absolute URL
  const resolveAssetUrl = (rel: string) => {
    try {
      if (!rel) return rel;
      if (rel.startsWith('http://') || rel.startsWith('https://')) return rel;
      if (backendOrigin) return `${backendOrigin}${rel}`;
      return `${window.location.origin}${rel}`;
    } catch (_) { return rel; }
  };

  const extractYouTubeIdFromUrl = (url: string) => {
    if (!url) return null;
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
    if (m && m[1]) return m[1];
    try { const u = new URL(url); return u.searchParams.get('v'); } catch (_) { return null; }
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-transparent dark:bg-transparent">
      {/* Video modal / lightbox */}
      {modalVideo && (
        <div onClick={closeVideoModal} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-3xl bg-black rounded-lg shadow-lg">
            <button
              onClick={closeVideoModal}
              aria-label="Tutup video"
              className="absolute -right-3 -top-3 z-50 bg-black/60 text-white rounded-full w-7 h-7 flex items-center justify-center p-0.5 shadow-sm hover:scale-105 transform transition focus:outline-none"
            >
              <svg className="w-3 h-3 text-white/95" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 18L18 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="w-full aspect-[16/9] bg-black flex items-center justify-center rounded-lg overflow-hidden">
              {(() => {
                const v = modalVideo as any;
                const ytId = (v && (v as any).embed) ? (v as any).embed : null;
                if (v.source === 'youtube' || (v.embed || extractYouTubeIdFromUrl(v.url))) {
                  const embed = v.embed || `https://www.youtube.com/embed/${extractYouTubeIdFromUrl(v.url || '')}`;
                  return (
                    <iframe
                      src={`${embed}${embed.indexOf('?') === -1 ? '?rel=0&autoplay=1' : '&autoplay=1'}`}
                      title={v.title || 'YouTube video'}
                      className="w-full h-full"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  );
                }
                return (
                  <video
                    controls
                    autoPlay
                    src={resolveAssetUrl(v.url)}
                    className="w-full h-full object-contain bg-black"
                  />
                );
              })()}
            </div>
          </div>
        </div>
      )}
      <div className={`${themeClasses.headerBar} px-6 py-4 flex items-center justify-between`}>
        <h2 className="text-white font-semibold text-lg flex items-center gap-2 font-display tracking-tight">
          <MessageCircle className="w-5 h-5" />
          Chat Assistant
        </h2>
        <div className="ml-4 flex items-center gap-2">
            <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNameEdit(true)}
              title={userName ? `Nama: ${userName}` : 'Set nama'}
              className="flex items-center gap-3 bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded-full transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold">
                {userName ? userName.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase() : 'U'}
              </div>
              <div className="text-sm text-white/90 truncate max-w-[10rem]">
                {userName ? userName : 'Set nama'}
              </div>
              <div className="text-xs opacity-80">✏️</div>
            </button>

            <div className="relative flex items-center gap-2">
              <button
                onMouseEnter={() => setShowResetLabel(true)}
                onMouseLeave={() => setShowResetLabel(false)}
                onClick={() => setShowResetConfirm(true)}
                title="Reset Percakapan"
                className="bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              {showResetLabel && (
                <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                  Reset
                </div>
              )}
              {/* no extra buttons here; theme follows app theme selection */}
            </div>
          </div>
        </div>
      </div>

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-0 pb-4 space-y-4 bg-transparent">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                message.type === 'user'
                    ? themeClasses.userBubble
                  : 'bg-white text-gray-800 shadow-sm border border-gray-100 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700'
              }`}
              style={message.type === 'user' ? { position: 'relative' } : {}}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
              {message.videos && message.videos.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.videos.map((v, idx) => (
                    <div key={idx} className="flex gap-3 items-start">
                      <div className="w-36 h-20 overflow-hidden rounded bg-black/5">
                        {(() => {
                          // show a clickable preview (thumbnail or small muted video). Clicking opens the modal
                          const ytId = extractYouTubeIdFromUrl(v.url || '');
                          const thumb = (v && (v as any).thumbnail) ? (v as any).thumbnail : null;
                          if (v.source === 'youtube' || ytId) {
                            return (
                              <div className="relative w-full h-full cursor-pointer" onClick={() => openVideoModal(v)}>
                                {thumb ? (
                                  <img src={thumb} alt={v.title || 'YouTube thumbnail'} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full bg-black" />
                                )}
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="bg-black/40 rounded-full p-2">
                                    <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          // fallback: local/native video preview
                          if (!videoErrorMap[v.url]) {
                            return (
                              <div className="relative w-full h-full cursor-pointer" onClick={() => openVideoModal(v)}>
                                <video muted playsInline className="w-full h-full object-cover" src={resolveAssetUrl(v.url)} preload="metadata" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="bg-black/40 rounded-full p-2">
                                    <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 px-2 text-center">
                              Tidak dapat diputar di browser
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex-1">
                        <button
                          onClick={() => { try { window.open(resolveAssetUrl(v.url), '_blank', 'noopener,noreferrer'); } catch (_) {} }}
                          className="font-medium text-sm text-blue-600 dark:text-blue-400 text-left"
                        >
                          {v.title || 'Video'}
                        </button>
                        <div className="text-xs text-gray-500">{v.mime || ''} {v && (v as any).size ? `· ${Math.round((v as any).size/1024)} KB` : ''}</div>
                        {videoErrorMap[v.url] && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => { try { window.open(resolveAssetUrl(v.url), '_blank', 'noopener,noreferrer'); } catch(_){} }}
                              className="text-xs px-2 py-1 bg-gray-100 dark:bg-slate-800 rounded"
                            >
                              Buka di tab baru
                            </button>
                            {!(v.source === 'youtube' || extractYouTubeIdFromUrl(v.url || '')) && (
                              <a
                                href={resolveAssetUrl(v.url)}
                                download
                                className="text-xs px-2 py-1 bg-gray-100 dark:bg-slate-800 rounded"
                              >
                                Download
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <Loader2 className={`w-5 h-5 animate-spin ${themeClasses.loaderColor}`} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        {showHelpdeskButton && !conversationId && (
          <div className="flex flex-col items-center mt-2 gap-2">
            {showNameRequiredNotice && (
              <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-800 rounded max-w-xl text-sm">
                Isi nama terlebih dahulu sebelum mengajukan ke helpdesk. Klik badge nama di header (dekat tombol reset) untuk mengisi. <button onClick={() => { setShowNameEdit(true); }} className="underline font-semibold ml-1">Isi sekarang</button>
              </div>
            )}
            <div>
              <button
                onClick={handleHelpdesk}
                className={`${themeClasses.primaryButton} px-6 py-2 rounded-xl font-medium shadow-md transition-all`}
                disabled={isLoading}
              >
                Ajukan ke Helpdesk
              </button>
            </div>
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
                className={`${themeClasses.primaryButton} p-3 rounded-lg shadow-md flex items-center justify-center`}
              >
                <ChevronsDown className="w-5 h-5" />
              </button>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-3 bg-transparent border-t-0">
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="relative flex-1" ref={categoryContainerRef}>
              {/* Custom dropdown to avoid native select clipping and small visible options */}
              <button
                type="button"
                onClick={() => setSelectedCategory((prev) => prev) /* noop to keep TS happy */}
                onMouseDown={(e) => { e.preventDefault(); /* prevent blur */ }}
                className={`w-full text-left px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${themeClasses.focusRing} focus:border-transparent bg-gray-50 dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100 flex items-center justify-between`}
                onClickCapture={(e) => { e.preventDefault(); setShowCategoryDropdown((s) => !s); }}
              >
                <span className={`truncate ${selectedCategory ? '' : 'text-gray-500 dark:text-slate-400'}`}>{selectedCategory || 'Pilih Kategori'}</span>
                <svg className="w-4 h-4 ml-2 text-gray-500" viewBox="0 0 20 20" fill="none"><path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {showCategoryDropdown && (
                <div className={`absolute left-0 right-0 z-50 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-auto ${dropdownUp ? 'bottom-full mb-2' : 'mt-2'}`}>
                  {categories.length === 0 && <div className="px-3 py-2 text-sm text-gray-500">Tidak ada kategori</div>}
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setSelectedCategory(c); setShowCategoryDropdown(false); }}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 text-sm ${selectedCategory === c ? 'font-semibold' : ''}`}
                    >
                      {c}
                    </button>
                  ))}
                  </div>
              )}
            </div>

            <label className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-gray-200 dark:border-slate-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
              <input
                type="checkbox"
                checked={useLLM}
                onChange={(e) => {
                  const v = e.target.checked;
                  setUseLLM(v);
                  if (typeof window !== 'undefined') localStorage.setItem('useLLM', v ? '1' : '0');
                }}
                className={`w-4 h-4 rounded ${themeClasses.checkboxColor}`}
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
              className={`flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 ${themeClasses.focusRing} focus:border-transparent dark:bg-slate-900/50 dark:border-slate-700 dark:text-slate-100`}
              required
            />
            <button
              type="submit"
              disabled={isLoading || !selectedCategory}
              className={`${themeClasses.primaryButton} px-6 py-3 rounded-xl font-medium focus:outline-none focus:ring-2 ${themeClasses.focusRing} focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg`}
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
              <button onClick={() => setShowResetConfirm(false)} className="px-4 py-2 rounded bg-gray-200 text-gray-800 dark:bg-slate-800 dark:text-slate-100 border border-transparent dark:border-slate-700">Batal</button>
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
      {showNameEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowNameEdit(false)} />
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 z-10 w-11/12 max-w-md">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-slate-100">Input Nama</h3>
            <p className="text-sm text-gray-700 dark:text-slate-300 mb-4">Masukkan nama yang akan dikirim ke helpdesk</p>
            <input
              type="text"
              value={userName || ''}
                ref={nameInputRef}
                onChange={(e) => setUserName(e.target.value)}
              placeholder="Nama Anda"
              className="w-full px-4 py-2 rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/50 text-gray-800 dark:text-slate-100 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowNameEdit(false)} className="px-4 py-2 rounded bg-gray-200 text-gray-800 dark:bg-slate-800 dark:text-slate-100 border border-transparent dark:border-slate-700">Batal</button>
              <button onClick={() => {
                setShowNameEdit(false);
                try { if (typeof window !== 'undefined') { if (userName && userName.trim()) localStorage.setItem('helpdesk_user_name', userName.trim()); else localStorage.removeItem('helpdesk_user_name'); } } catch(_) {}
              }} className={`${themeClasses.primaryButton} px-4 py-2 rounded`}>Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
