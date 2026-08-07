import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import type { CopilotResponseDto, CopilotSourceDto } from '@crm/shared';
import { api } from '../api/client.js';
import { Button, ErrorNote, inputClass } from './ui.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: CopilotSourceDto[];
  navigation?: { url: string; label: string } | null;
}

const SUGGESTIONS = [
  'How are sales this month?',
  'Which deals are at risk?',
  'What should I do next?',
  'Prep me for my next meeting',
];

export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [text, setText] = useState('');
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (message: string) =>
      api<CopilotResponseDto>('/api/copilot/ask', {
        method: 'POST',
        body: { message, ...(conversationId ? { conversationId } : {}) },
      }),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.message, sources: res.sources, navigation: res.navigation },
      ]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, ask.isPending]);

  function send(message: string) {
    const trimmed = message.trim();
    if (!trimmed || ask.isPending) return;
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setText('');
    ask.mutate(trimmed);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send(text);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open copilot"
        onClick={() => setOpen((s) => !s)}
        className="fixed bottom-5 right-5 z-30 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-700"
      >
        {open ? '✕' : '✦ Copilot'}
      </button>

      {open ? (
        <div className="fixed bottom-20 right-5 z-30 flex h-[34rem] w-[26rem] flex-col rounded-lg border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-semibold text-gray-800">CRM Copilot</p>
            <button
              type="button"
              className="text-xs text-blue-700 hover:underline"
              onClick={() => {
                setMessages([]);
                setConversationId(undefined);
                ask.reset();
              }}
            >
              New chat
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">
                  Ask about your accounts, deals, and numbers. Answers come only from your CRM data.
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="block w-full rounded border border-dashed border-gray-300 px-2 py-1.5 text-left text-xs text-gray-600 hover:border-blue-400 hover:text-blue-700"
                    onClick={() => send(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.sources && m.sources.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.sources.map((s) => (
                        <button
                          key={`${s.type}:${s.id}`}
                          type="button"
                          disabled={!s.url}
                          className="rounded bg-white px-1.5 py-0.5 text-xs text-blue-700 shadow-sm hover:underline disabled:text-gray-400"
                          title={`grounded in this ${s.type}`}
                          onClick={() => {
                            if (s.url) {
                              navigate(s.url);
                              setOpen(false);
                            }
                          }}
                        >
                          {s.type}: {s.title}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {m.navigation ? (
                    <div className="mt-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          navigate(m.navigation!.url);
                          setOpen(false);
                        }}
                      >
                        {m.navigation.label} →
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            {ask.isPending ? <p className="text-xs text-gray-400">Thinking…</p> : null}
            <ErrorNote error={ask.error} />
            <div ref={bottomRef} />
          </div>

          <form onSubmit={submit} className="flex gap-2 border-t border-gray-100 p-2">
            <input
              className={inputClass}
              placeholder="Ask your CRM…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" disabled={ask.isPending || text.trim() === ''}>
              Send
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}
