import { createFileRoute, redirect } from "@tanstack/react-router";

// WS3: Memory is now Projects (sidebar). The research/profile editor moved
// under Settings → Profile & Defaults; this old URL stays working and
// forwards there. The legacy Memory panel components remain in
// src/components/memory/ for rollback.
export const Route = createFileRoute("/_authenticated/memory")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});
