/**
 * Subtle divider between Hero and Features. Pure neutral platinum mist —
 * never dims the next section's eyebrow text.
 */
export function GradientMeshTransition() {
  return (
    <div
      aria-hidden
      className="relative h-[10vh] w-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      <div
        className="absolute -top-1/4 left-[18%] w-[55%] h-[140%] rounded-full opacity-[0.22]"
        style={{
          background: "radial-gradient(circle, #ffffff 0%, transparent 70%)",
          filter: "blur(120px)",
          animation: "meshDrift1 18s ease-in-out infinite",
        }}
      />
      <div
        className="absolute -bottom-1/4 right-[15%] w-[45%] h-[120%] rounded-full opacity-[0.14]"
        style={{
          background: "radial-gradient(circle, #b8c8e0 0%, transparent 70%)",
          filter: "blur(140px)",
          animation: "meshDrift2 22s ease-in-out infinite",
        }}
      />
      {/* bottom fade so the next section starts clean */}
      <div
        className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, transparent 0%, var(--bg-base) 100%)",
        }}
      />
    </div>
  );
}
