# Design Direction - QuickBuild Downloader

> **Identity**: High-precision, ultra-resilient native download workstation engineered to bypass severe IT line throttling (700 kbps) and handle massive concurrent workloads (186 × 20 GB artifacts/week).

---

## Antislop Dials

| Dial | Level | Purpose & Character |
|---|---|---|
| **ENERGY** | **2 (Balanced Workstation)** | Professional, focused, industrial-grade. No distracting neon radial orbs or excessive decorative glows. |
| **RHYTHM** | **2 (Structured Hierarchy)** | Clear functional zones: sticky control topbar, key performance metric strip, and task group accordions. |
| **MOTION** | **1 (Calm & Fast)** | Fast micro-interactions (150ms transitions). No intrusive scroll-reveal fade-ups or spring bounce effects. |

---

## Color Tokens

### Light Mode (`[data-theme="light"]`)
- **Background App**: `#f8fafc` (Cool slate canvas)
- **Surface Card**: `#ffffff` (Pure white elevation)
- **Surface Elevated / Hover**: `#f1f5f9` (Subtle hover state)
- **Border Default**: `#cbd5e1` (Crisp 1px border)
- **Text Primary**: `#0f172a` (High-contrast deep slate, WCAG AA pass 14.5:1)
- **Text Secondary**: `#475569` (Slate grey, WCAG AA pass 6.8:1)
- **Text Muted**: `#64748b` (Muted caption, WCAG AA pass 4.6:1)
- **Primary Accent**: `#0284c7` (Industrial blue)
- **Success Accent**: `#166534` / `#dcfce7` (Crisp forest green)
- **Warning Accent**: `#92400e` / `#fef3c7` (Amber warning)
- **Danger Accent**: `#9f1239` / `#ffe4e8` (Rose red)

### Dark Mode (`[data-theme="dark"]`)
- **Background App**: `#090d16` (Deep industrial charcoal)
- **Surface Card**: `#131b2e` (Elevated dark slate card)
- **Surface Elevated / Hover**: `#1e293b` (Interactive hover fill)
- **Border Default**: `#2a374e` (Subtle metallic border)
- **Text Primary**: `#f8fafc` (Bright white slate)
- **Text Secondary**: `#94a3b8` (Light slate grey)
- **Text Muted**: `#64748b` (Muted dark slate)
- **Primary Accent**: `#38bdf8` (Vibrant cyan-blue)
- **Success Accent**: `#4ade80` / `#064e3b` (Vibrant emerald)
- **Warning Accent**: `#fbbf24` / `#451a03` (Warm amber)
- **Danger Accent**: `#f87171` / `#4c0519` (Rose red)

---

## Typography & Numbers

- **Primary Font**: `Inter, system-ui, sans-serif`
- **Numerical Alignment**: `tabular-nums` for real-time speed, byte counts, and ETA metrics to prevent layout jitter.
- **Copywriting Hygiene**: Zero em dashes (`—`), zero generic buzzwords ("seamless", "revolutionary", "AI-powered"). Direct technical prose only.

---

## Accessibility & Keyboard Locks

- All interactive controls are focusable with visible high-contrast focus rings (`:focus-visible`).
- Contrast ratios strictly satisfy WCAG AA standards in both Light and Dark themes.
- Escape closes modals and popups; Tab/Shift+Tab cycles through logical DOM order.
