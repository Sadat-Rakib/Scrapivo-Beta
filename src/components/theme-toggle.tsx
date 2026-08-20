import { Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs">
      <button
        onClick={() => setTheme("light")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${
          theme === "light" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
        }`}
      >
        <Sun className="size-3.5" /> Light
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${
          theme === "dark" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
        }`}
      >
        <Moon className="size-3.5" /> Dark
      </button>
    </div>
  );
}
