import { Mic, MicOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type VoiceState = "idle" | "listening" | "transcribing";

type Props = {
  /** Called with each final transcript chunk (caller should append). */
  onResult: (text: string) => void;
  /** Optional interim partial transcript for live preview. */
  onInterim?: (text: string) => void;
};

let whisperSingleton: {
  transcribe: (file: File, opts: { language: string }) => AsyncIterable<{ text?: string }>;
} | null = null;
let whisperLoad: Promise<NonNullable<typeof whisperSingleton>> | null = null;

async function getWhisper() {
  if (whisperSingleton) return whisperSingleton;
  if (!whisperLoad) {
    whisperLoad = (async () => {
      const { BrowserWhisper } = await import("browser-whisper");
      const instance = new BrowserWhisper({ model: "whisper-tiny" });
      whisperSingleton = instance as NonNullable<typeof whisperSingleton>;
      return whisperSingleton;
    })().catch((err) => {
      whisperLoad = null;
      throw err;
    });
  }
  return whisperLoad;
}

/**
 * Voice input: Web Speech API for low-latency live dictation (Chrome/Edge),
 * with cached browser-whisper (whisper-tiny) fallback when Web Speech is unavailable.
 */
export function VoiceInputButton({ onResult, onInterim }: Props) {
  const [state, setState] = useState<VoiceState>("idle");
  const [hint, setHint] = useState<string>("Voice input");
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [hasMedia, setHasMedia] = useState(false);
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stateRef = useRef<VoiceState>("idle");
  const wantListenRef = useRef(false);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onResultRef.current = onResult;
    onInterimRef.current = onInterim;
  }, [onResult, onInterim]);

  useEffect(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    setHasWebSpeech(!!SR);
    setHasMedia(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    return () => {
      wantListenRef.current = false;
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      try {
        if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stopWebSpeech = (clearWant = true) => {
    if (clearWant) wantListenRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setState("idle");
    setHint("Voice input");
  };

  const startWebSpeech = (): boolean => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return false;

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = (result?.[0]?.transcript ?? "").trim();
        if (!transcript) continue;
        if (result.isFinal) finalChunk += (finalChunk ? " " : "") + transcript;
        else interim += (interim ? " " : "") + transcript;
      }
      if (interim) onInterimRef.current?.(interim);
      if (finalChunk) onResultRef.current(finalChunk);
    };

    rec.onerror = (e: any) => {
      const code = String(e?.error || "unknown");
      if (code === "aborted" || code === "no-speech") {
        // Normal when pausing; restart loop handles continuous listen.
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        wantListenRef.current = false;
        setState("idle");
        setHint("Mic permission blocked");
        toast.error("Microphone permission blocked — allow mic in the browser.");
        return;
      }
      if (code === "network") {
        toast.error("Speech recognition network error — try again or use Whisper fallback.");
      } else if (code !== "no-speech") {
        toast.message(`Voice: ${code}`);
      }
    };

    rec.onend = () => {
      recRef.current = null;
      // Restart while user still wants to listen (browser ends after silence).
      if (wantListenRef.current && stateRef.current === "listening") {
        try {
          const again = new SR();
          again.lang = "en-US";
          again.continuous = true;
          again.interimResults = true;
          again.maxAlternatives = 1;
          again.onresult = rec.onresult;
          again.onerror = rec.onerror;
          again.onend = rec.onend;
          recRef.current = again;
          again.start();
          return;
        } catch {
          wantListenRef.current = false;
          setState("idle");
          setHint("Voice input");
          return;
        }
      }
      if (stateRef.current === "listening") {
        setState("idle");
        setHint("Voice input");
      }
    };

    try {
      recRef.current = rec;
      wantListenRef.current = true;
      rec.start();
      setState("listening");
      setHint("Listening… (click to stop)");
      return true;
    } catch (err) {
      console.warn("[voice] Web Speech start failed", err);
      wantListenRef.current = false;
      return false;
    }
  };

  const transcribeWithWhisper = async (blob: Blob) => {
    setState("transcribing");
    setHint("Transcribing (Whisper)…");
    try {
      if (blob.size < 800) {
        toast.message("No speech captured — hold the mic a bit longer.");
        return;
      }
      const whisper = await getWhisper();
      if (!whisper) throw new Error("Whisper failed to load");
      const file = new File([blob], "voice.webm", { type: blob.type || "audio/webm" });
      let text = "";
      for await (const segment of whisper.transcribe(file, { language: "en" })) {
        text += ((segment as { text?: string }).text || "") + " ";
      }
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned) onResultRef.current(cleaned);
      else toast.message("Couldn’t hear anything — try again closer to the mic.");
    } catch (err) {
      console.warn("[voice] Whisper fallback failed", err);
      toast.error("Voice transcription failed. Check mic permission and try again.");
    } finally {
      setState("idle");
      setHint("Voice input");
    }
  };

  const startWhisperCapture = async () => {
    if (!hasMedia) {
      toast.error("Microphone not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = mime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        mediaRef.current = null;
        if (blob.size > 0) await transcribeWithWhisper(blob);
        else {
          setState("idle");
          setHint("Voice input");
          toast.message("No audio recorded.");
        }
      };
      mediaRef.current = recorder;
      recorder.start(250);
      setState("listening");
      setHint("Recording… (click to stop & transcribe)");
    } catch (err: any) {
      const name = String(err?.name || "");
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        toast.error("Microphone permission blocked — allow mic in the browser.");
      } else {
        toast.error("Couldn’t open the microphone.");
      }
      setState("idle");
      setHint("Voice input");
    }
  };

  const toggle = () => {
    if (state === "transcribing") return;

    if (state === "listening") {
      if (mediaRef.current && mediaRef.current.state !== "inactive") {
        mediaRef.current.stop();
        return;
      }
      stopWebSpeech(true);
      return;
    }

    if (hasWebSpeech) {
      if (!startWebSpeech()) {
        if (hasMedia) void startWhisperCapture();
        else toast.error("Voice input unavailable.");
      }
      return;
    }
    void startWhisperCapture();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={hint}
      title={hint}
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
