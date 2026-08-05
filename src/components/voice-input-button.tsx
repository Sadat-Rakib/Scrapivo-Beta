import { Mic, MicOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type VoiceState = "idle" | "listening" | "transcribing" | "unsupported";

/**
 * Voice input: Web Speech API for low-latency live dictation (Chrome/Edge),
 * with browser-whisper (whisper-tiny) fallback when Web Speech is unavailable.
 */
export function VoiceInputButton({ onResult }: { onResult: (text: string) => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [hasMedia, setHasMedia] = useState(false);
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stateRef = useRef<VoiceState>("idle");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    setHasWebSpeech(!!SR);
    setHasMedia(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
    if (!SR && !(typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia)) {
      setState("unsupported");
    }
  }, []);

  if (state === "unsupported") {
    return (
      <Button type="button" variant="ghost" size="icon" disabled title="Voice input not supported">
        <Mic className="size-4 opacity-40" />
      </Button>
    );
  }

  const stopWebSpeech = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setState("idle");
  };

  const startWebSpeech = () => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return false;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) onResult(transcript.trim());
      setState("idle");
    };
    rec.onerror = () => setState("idle");
    rec.onend = () => {
      if (stateRef.current === "listening") setState("idle");
    };
    recRef.current = rec;
    rec.start();
    setState("listening");
    return true;
  };

  const transcribeWithWhisper = async (blob: Blob) => {
    setState("transcribing");
    try {
      const { BrowserWhisper } = await import("browser-whisper");
      const whisper = new BrowserWhisper({ model: "whisper-tiny" });
      const file = new File([blob], "voice.webm", { type: blob.type || "audio/webm" });
      let text = "";
      for await (const segment of whisper.transcribe(file, { language: "en" })) {
        text += ((segment as { text?: string }).text || "") + " ";
      }
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned) onResult(cleaned);
    } catch (err) {
      console.warn("[voice] Whisper fallback failed", err);
    } finally {
      setState("idle");
    }
  };

  const startWhisperCapture = async () => {
    if (!hasMedia) {
      setState("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        mediaRef.current = null;
        if (blob.size > 0) await transcribeWithWhisper(blob);
        else setState("idle");
      };
      mediaRef.current = recorder;
      recorder.start();
      setState("listening");
    } catch {
      setState("unsupported");
    }
  };

  const toggle = () => {
    if (state === "transcribing") return;

    if (state === "listening") {
      if (mediaRef.current && mediaRef.current.state !== "inactive") {
        mediaRef.current.stop();
        return;
      }
      stopWebSpeech();
      return;
    }

    if (hasWebSpeech) {
      if (!startWebSpeech() && hasMedia) void startWhisperCapture();
      return;
    }
    void startWhisperCapture();
  };

  const label =
    state === "listening"
      ? "Listening… (click to stop)"
      : state === "transcribing"
        ? "Transcribing (Whisper)…"
        : "Voice input";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={label}
      title={label}
      disabled={state === "transcribing"}
    >
      {state === "transcribing" ? (
        <Loader2 className="size-4 animate-spin text-primary" />
      ) : state === "listening" ? (
        <MicOff className="size-4 text-primary animate-pulse" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  );
}
