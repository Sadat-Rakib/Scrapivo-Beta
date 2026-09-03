# Apple Liquid Glass — Design System Spec

**Purpose:** A reusable reference for implementing the "peak liquid glass" treatment anywhere on the site (dashboard input bar, dashboard results panel, and any future component that should carry this specific premium glass identity). Distinct from the flatter glassmorphism already used on the bento cards and FAQ — this is a deliberately higher tier, reserved for standout moments only.

---

## When to use this vs. the standard glass styles already on the site

| Style | Where it's used | Character |
|---|---|---|
| **Bento card glass** | How It Works section | Flat, subtle translucency, soft edge-glow gradient |
| **FAQ liquid glass** | FAQ accordion | Heavier blur, premium, but still relatively flat/2D |
| **Apple liquid glass (this spec)** | Dashboard search bar + results panel; reserved for future standout elements | Deep, dimensional, refractive — reads as an actual physical material with thickness and light behavior |

Do not apply this spec to the bento cards or FAQ — they keep their existing distinct treatments. This tier is reserved for elements that should feel like the single most premium surface on the page.

---

## Core visual principles

1. **The surface has thickness.** Real glass isn't a flat translucent rectangle — it has a visible top edge that catches light and a bottom edge that falls into shadow. Every element using this spec needs both an inner top-highlight and an inner bottom-shadow to sell that thickness.
2. **Light comes from one consistent direction across the whole page.** Pick one light-source direction (recommended: upper-left) and use it for every element using this spec — the input bar, its chips, its buttons, and the results panel below it should all look lit from the same angle, so they read as one continuous material.
3. **The blur is heavy, not light.** This should feel noticeably thicker/more frosted than the site's other glass elements — if it looks similar in weight to the bento cards, it's not blurred enough.
4. **There's a soft, off-center specular bloom.** A diffuse light bloom (not a hard glare) suggests a curved, glossy surface — position it away from center, near the light-source corner.
5. **It responds subtly to interaction.** Focus/hover states should gently intensify the glass (slightly brighter bloom, marginally deeper blur) — never abrupt, never distracting.
6. **Legibility is non-negotiable.** No matter how deep the glass effect gets, text and content in front of it must stay fully readable. If a design choice ever threatens legibility, back off the effect rather than the contrast.

---

## Implementation recipe (CSS)

```css
.liquid-glass {
  position: relative;
  border-radius: 24px; /* generous, "liquid" rounding — larger than standard site radius */
  background: rgba(255, 255, 255, 0.06); /* base translucent tint over dark bg */
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);

  /* Layered shadows: outer lift + inner top highlight + inner bottom shadow */
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.35),               /* outer lift off the page */
    inset 0 1px 0 rgba(255, 255, 255, 0.25),       /* top edge highlight */
    inset 0 -1px 0 rgba(0, 0, 0, 0.25);            /* bottom edge dimming */

  overflow: hidden; /* required for the ::before bloom to clip to the rounded shape */
}

/* Soft off-center specular bloom */
.liquid-glass::before {
  content: "";
  position: absolute;
  top: -20%;
  left: -10%;
  width: 60%;
  height: 60%;
  background: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.18) 0%,
    rgba(255, 255, 255, 0) 70%
  );
  pointer-events: none;
}

/* Subtle interactive intensification */
.liquid-glass:focus-within,
.liquid-glass:hover {
  background: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 8px 36px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.32),
    inset 0 -1px 0 rgba(0, 0, 0, 0.25);
  transition: background 0.4s ease, box-shadow 0.4s ease;
}

@media (prefers-reduced-motion: reduce) {
  .liquid-glass:focus-within,
  .liquid-glass:hover {
    transition: none;
  }
}
```

**Scaling for smaller elements** (chips, circular buttons): keep the same layered box-shadow logic and blur value, but reduce `border-radius` proportionally (use `border-radius: 9999px` for fully circular/pill elements) and reduce the bloom's `width`/`height` percentages so it doesn't overwhelm a small element.

**Nested rows/content inside a large glass panel** (e.g. a results table): do NOT apply this full spec to each row — only the outer container should carry it. Inner rows get at most a light `background: rgba(255,255,255,0.03)` hover state, no independent blur/bloom, so the glass effect isn't visually noisy when repeated dozens of times.

---

## Performance & compatibility checklist

- [ ] Test scroll performance with `backdrop-filter` active on larger elements (the results panel) — heavy blur on large surfaces can cause jank on lower-end devices. If jank appears, reduce blur radius before removing the effect entirely.
- [ ] Confirm graceful degradation on browsers without `backdrop-filter` support — the element should still look intentional (translucent background + shadows) even without the blur.
- [ ] Respect `prefers-reduced-motion` for all hover/focus transitions.
- [ ] Verify text contrast remains accessible (WCAG AA minimum) against the glass background across all content that sits on top of it, including as dynamic content (dashboard rows, typewriter text) changes underneath.

---

## Quick reference — what "done right" looks like

- You should be able to look at the element and immediately clock it as a different, higher tier of material than the bento cards or FAQ.
- The top edge should look like it's catching light; the bottom edge should look like it's falling into shadow.
- There should be a soft glow/bloom, not a hard highlight or a flat gradient.
- It should feel alive on interaction, not static.
- No amount of "make it glassier" should ever come at the cost of the text on top of it being hard to read.
