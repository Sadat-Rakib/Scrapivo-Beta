import { Link } from "@tanstack/react-router";

export function ScrapivoLandingFooter({
  authTo,
  authSearch,
}: {
  authTo: "/auth" | "/discover";
  authSearch?: { mode: "signup" };
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="scrapivo-cta-footer">
      <div className="cta-beam-wrap" aria-hidden>
        <div className="cta-beam-dots" />
        <div className="cta-beam-glow" />
      </div>

      <div className="cta-main">
        <div className="cta-clock-col">
          <div className="cta-clock" aria-hidden>
            <div className="cta-clock-halo" />
            <div className="cta-clock-shell" />
            <div className="cta-clock-inner-rim" />

            <div className="cta-clock-face">
              <div className="cta-glow-orange" />
              <div className="cta-glow-blue" />
              <div className="cta-face-shade" />
              <div className="cta-face-dots" />
              <div className="cta-face-reflect" />
            </div>

            <div className="cta-ticks" />
            <div className="cta-major-ticks" />
            <div className="cta-ring-a" />
            <div className="cta-ring-b" />

            <div className="cta-nums">
              <span className="cta-n12">12</span>
              <span className="cta-n1">1</span>
              <span className="cta-n2">2</span>
              <span className="cta-n3">3</span>
              <span className="cta-n4">4</span>
              <span className="cta-n6">6</span>
              <span className="cta-n8">8</span>
              <span className="cta-n9">9</span>
              <span className="cta-n10">10</span>
            </div>

            <div className="cta-mark">
              <div className="cta-mark-inner">
                <div className="cta-mark-blur" />
                <svg viewBox="0 0 140 140" aria-hidden>
                  <text
                    x="70"
                    y="98"
                    textAnchor="middle"
                    fill="#08090c"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="2"
                    style={{
                      fontSize: 96,
                      fontFamily: "Georgia, 'Times New Roman', serif",
                      fontWeight: 700,
                    }}
                  >
                    S
                  </text>
                </svg>
              </div>
            </div>

            <div className="cta-rot-cw">
              <div className="cta-arc-blue" />
              <div className="cta-hand-blue">
                <div className="cta-hand-tip" />
              </div>
            </div>

            <div className="cta-rot-ccw">
              <div className="cta-arc-orange" />
              <div className="cta-hand-orange">
                <div className="cta-hand-tip" />
              </div>
            </div>

            <div className="cta-rot-slow">
              <div className="cta-hand-dim" />
            </div>

            <div className="cta-pivot">
              <div className="cta-pulse" />
            </div>
            <div className="cta-crown" />
          </div>
        </div>

        <div className="cta-copy">
          <div className="cta-eyebrow">SCRAPIVO</div>
          <h2 className="cta-title">Find buyers who already want you</h2>
          <p className="cta-desc">
            Scan live public intent across the open web, scored Hot and Warm, segmented into Posts,
            Companies, and People. Outreach stays draft-only until you send.
          </p>
          <div className="cta-actions">
            <div className="cta-btn-wrap">
              <div className="cta-btn-glow" aria-hidden />
              <Link to={authTo} search={authSearch} className="cta-btn-primary">
                Join Inner Circle
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="cta-bottom">
        <div className="cta-bottom-inner">
          <div>Copyright © {year} Scrapivo. All rights reserved.</div>
          <div className="cta-bottom-links">
            <a href="#faq-section">Terms of Use</a>
            <a href="#faq-section">Privacy Protocol</a>
          </div>
          <div className="cta-bottom-social">
            <a
              href="https://www.instagram.com/scrapivo"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
            >
              IG
            </a>
            <a
              href="https://www.linkedin.com/company/scrapivo/"
              target="_blank"
              rel="noreferrer"
              aria-label="LinkedIn"
            >
              in
            </a>
            <a href="mailto:mirsadat@scrapivo.com" aria-label="Contact">
              ✉
            </a>
          </div>
          <div className="cta-bottom-made">
            <span>Go To Place For Leads</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
