import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X, Minus } from "lucide-react";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function ScrapyChatPanel({
  open,
  onClose,
  messages,
  onSend,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatTurn[];
  onSend: (text: string) => void;
  pending: boolean;
}) {
  const [input, setInput] = useState("");
  const [minimized, setMinimized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  if (!open) return null;

  const send = () => {
    const t = input.trim();
    if (!t || pending) return;
    onSend(t);
    setInput("");
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(380px,calc(100vw-2rem))]">
      <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-gradient-to-r from-primary/15 to-transparent">
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center">
              <Sparkles className="size-3.5 text-primary" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Scrapy</div>
              <div className="text-[10px] text-muted-foreground">your lead-finding AI</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMinimized((v) => !v)}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="Minimize"
            >
              <Minus className="size-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-accent text-muted-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {!minimized && (
          <>
            <div
              ref={scrollRef}
              className="px-3.5 py-3 max-h-[420px] min-h-[260px] overflow-y-auto space-y-2.5"
            >
              {messages.length === 0 && (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>Hey! I'm Scrapy</p>
                  <p>What do you want to find now — your skill, ideal client, or the kind of project? I'll craft the search and run it for you.</p>
                  <p className="text-xs opacity-70">Try: "founders needing help with React performance"</p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> Scrapy is thinking…
                </div>
              )}
            </div>

            <div className="border-t border-border p-2 flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 1000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                rows={1}
                placeholder="Talk to Scrapy…"
                className="flex-1 resize-none bg-transparent text-sm px-2 py-1.5 outline-none max-h-28"
              />
              <button
                onClick={send}
                disabled={pending || !input.trim()}
                className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
                aria-label="Send"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}