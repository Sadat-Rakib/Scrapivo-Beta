import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { mySupabase } from "@/integrations/my-supabase/client";
import { HeroSection } from "@/components/landing/HeroSection";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scrapivo — Get Verified Leads Without Chaos" },
      {
        name: "description",
        content:
          "Get verified leads without chaos. No more scrolling for hours or buying dead contact lists. Scrapivo finds real buyers and verifies them instantly.",
      },
      { property: "og:title", content: "Scrapivo — Get Verified Leads Without Chaos" },
      {
        property: "og:description",
        content:
          "Get verified leads without chaos. No more scrolling for hours or buying dead contact lists. Scrapivo finds real buyers and verifies them instantly.",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:image",
        content:
          "https://ytjbrwnwdlsituevqkys.supabase.co/storage/v1/object/public/Scrapivo%20Assets/logo%20(1).png",
      },
      { name: "twitter:title", content: "Scrapivo — Get Verified Leads Without Chaos" },
      {
        name: "twitter:description",
        content:
          "Get verified leads without chaos. No more scrolling for hours or buying dead contact lists. Scrapivo finds real buyers and verifies them instantly.",
      },
    ],
  }),
  component: Landing,
  ssr: false,
});

function Landing() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    mySupabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = mySupabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  const cta = authed ? "/discover" : "/auth";
  const ctaLabel = authed ? "Open app" : "Join";

  return <HeroSection cta={cta} ctaLabel={ctaLabel} />;
}
