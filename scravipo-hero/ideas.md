# Scravipo Hero — Ground-Truth Reference Spec

This is a reference-replication task. The supplied screenshot is the ground truth; fidelity takes priority over generic landing-page conventions.

## Chosen direction: Dark editorial monument

The hero is a premium, cinematic editorial composition: a near-black textured field, restrained frosted navigation, monumental white serif typography, and a cropped classical marble statue entering from the lower-right edge. The visual language should feel quiet, intelligent, and consequential rather than tech-generic.

### Design Movement
Contemporary luxury editorial design with art-direction cues from fashion campaigns, museum catalogues, and brutalist web layouts.

### Core Principles
- **Monumental type:** oversized condensed serif headline with tight tracking and a 1.1 line rhythm.
- **Asymmetric balance:** centered copy is counterweighted by the oversized statue on the right.
- **Material depth:** matte charcoal texture, restrained vignette, and marble grain replace flat fills.
- **Measured restraint:** small metadata, quiet nav, and a single high-contrast CTA keep the hierarchy focused.

### Color Philosophy
Near-black graphite provides a gallery-like background that makes the statue and headline read as objects under a dim spotlight. Warm ivory is used instead of pure white for a softer, print-like contrast. The signature brand color is **chalk ivory `#F3F1EC`**, repeated in typography and CTAs.

### Layout Paradigm
A full-viewport editorial stage with a floating rounded nav near the top, a centered typographic stack offset slightly above center, and a large absolute statue crop anchoring the bottom-right. The statue is intentionally allowed to leave the frame.

### Signature Elements
- Translucent black rounded navigation capsule with a subtle hairline border.
- Monumental three-line serif lockup: “Get / Opportunities / that matter”.
- Photographic classical bust cropped at the lower-right corner.

### Interaction Philosophy
Interactions should feel like tactile print: brief opacity shifts, tiny vertical settling, and a 0.97 active press scale. No loud glow, bounce, or over-animated UI.

### Animation
Use a restrained entrance reveal for the nav, headline, supporting copy, statue, and CTA, staggered by 40–70ms. Animate only opacity and transform, use a custom ease-out, keep the motion under 300ms, and disable non-essential motion for `prefers-reduced-motion`.

### Typography System
Use `Times New Roman MT Condensed` first, then `Times New Roman`, `Times`, and generic serif. The headline targets `letter-spacing: -0.085em` and `line-height: 1.1`; small copy uses a compact neutral sans fallback for legibility and contrast.

### Brand Essence
Scravipo turns live web signals into verified business opportunities for people who value relevance over noise. Personality: **discerning, direct, quietly ambitious**.

### Brand Voice
Headlines are short, declarative, and human. CTAs are one-word invitations. Microcopy is factual and specific.

Example lines:
- “The right signal changes the room.”
- “No random leads.”

### Wordmark & Logo
Use a compact inline white flame/scribble mark beside the Scravipo wordmark, treated as a hand-drawn editorial seal rather than a default text logo.

### Signature Brand Color
**Chalk ivory `#F3F1EC`**.

## File constraint

Only one custom application file is to be authored: `client/src/components/HeroSection.tsx`. The supplied statue is embedded as a data URI in that component so no separate image file is needed. This planning file is project documentation and is not part of the application component deliverable.
