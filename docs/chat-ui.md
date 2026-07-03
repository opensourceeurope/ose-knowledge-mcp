# Chat UI — design system & working notes

The public chat page lives in [`chat/`](../chat) — a 100% static site (HTML/CSS/vanilla
JS, no build step, no framework). This doc is the design reference so you don't have to
reverse-engineer the look and feel every time. For how it's deployed and its
sovereignty/cost posture, see [`deploy-chat.md`](deploy-chat.md) and
[`architecture.md`](architecture.md).

Files: `index.html` (markup), `styles.css` (all styling + tokens), `app.js` (behaviour),
`markdown.js` (answer rendering), `config.js` (deployed config — see the gotcha below),
`config.template.js` + `render-config.sh` (CI renders `config.js` from repo variables).

## Design language

The look mirrors **opensourceeurope.org**: a dark teal "ink" canvas with warm
orange/amber + teal atmospheric glows and a signature 4-colour gradient. It is calm,
sovereign, and text-first — not a flashy SaaS chatbot.

**Palette / tokens** (defined in `:root` at the top of `styles.css` — always use the
variables, never hard-code hex):

| Token | Value | Use |
| --- | --- | --- |
| `--ose-ink` | `#0A242B` | page background, dark surfaces |
| `--ose-ink-2` | `#0E282F` | card fill (e.g. panels) |
| `--ose-ink-3` | `#163037` | ring-button hover fill |
| `--ose-cyan` | `#9FE7F5` | accent — **citation chips + code text only** |
| `--ose-orange` / `--ose-yellow` | `#F27F0C` / `#F7AD1A` | warm accents (logo, glows) |
| `--ose-gradient` | `linear-gradient(135deg, #419EBD 10%, #9FE7F5 25%, #F7AD1A 75%, #F27F0C 100%)` | the signature ring/eyebrow gradient |
| `--border` / `--border-soft` | white @ 16% / 10% | 2px card borders / 1px hairlines |
| `--text` / `--text-soft` / `--text-muted` | white @ 100% / 75% / 55% | body / secondary / labels |
| `--ose-radius-card` / `-md` / `-pill` | 24px / 12px / 9999px | rounding |

Borders are neutral white-alpha — **do not tint them cyan**. Cyan is reserved for citation
chips and inline code text.

**Atmosphere:** `.atmosphere` is a fixed, pure-CSS layered `radial-gradient` (no image
downloads) rendering the site's hero glow. Keep it image-free.

**Typography:** self-hosted **Manrope** woff2 (weights 300–800 in `chat/fonts/`) — no
third-party font CDN (this is part of the sovereignty story). Body weight is **300**;
headings are **600** (semibold), not extra-bold. `--ose-font` is the stack.

**Logo / icon:** `ose-logo.svg` (wordmark, ~95×40 in header) and `favicon.svg` — a 3×3
dot-matrix glyph in `#F27F0C` on a 50×50 canvas. The header logo links to
opensourceeurope.org in a new tab.

**Motion:** `.reveal` gives one orchestrated page-load entrance (rise + fade). Stagger with
`data-reveal="1|2|3"` (header → hero/panels → chat). All motion is disabled under
`prefers-reduced-motion`.

## Component inventory

Reuse these before inventing new markup — most additions are a recombination of existing
components.

- **`.wrap`** — centered column, `max-width: 920px`, responsive gutters.
- **`.ring`** — the signature pill button: a 2px gradient ring around a dark core; hover
  and `aria-expanded="true"` fill the core with `--ose-ink-3`. `.ring--send` is the round
  variant. Header toggles use this.
- **`.tools-panel`** — a collapsible full-width card (`--ose-ink-2`, 2px border). Has
  `.tools-panel__head` (`__title` + `__sub`) and a `.tools-grid` (2-col ≥720px;
  `.snippet--wide` spans both columns). Both the "Local-first" and "Sovereign by design"
  panels are instances of this.
- **`.snippet`** — a box with a header bar (`.snippet__bar` + `.snippet__label`) over a
  body. Two body styles:
  - **Code:** `.snippet__code` (monospace, cyan) usually with a `.btn--copy` copy button
    in the bar and a `.snippet__hint` caption below.
  - **Prose:** `.snippet__hint.snippet__hint--body` — plain readable paragraph, **no copy
    button**. Use this for explanatory boxes (the Sovereignty panel uses it).
- **`.chip--suggest`** — the "Try:" example-question pills.
- **`.citation-chip`** — numbered source chips under an answer (cyan number badge).
- **`.loader`** — the animated "thinking" dots bubble.
- **`.composer`** — the input row (`.composer__input` textarea + `.ring--send`) and the
  analytics `.optin` checkbox.

## Interaction patterns

- **Collapsible panels** are driven by `app.js`: toggling the `hidden` attribute on the
  panel and mirroring state to the button's `aria-expanded`. The header panels behave as an
  **accordion** — opening one closes the other (they occupy the same spot). Opening scrolls
  the panel into view. Add a new panel by following the same `{ toggle, panel }` shape.
- **Copy buttons** use `data-copy="<id>"` pointing at the element whose `textContent` is
  copied; `app.js` wires them generically and flashes "Copied".
- **Accessibility:** every interactive control needs a visible label or `aria-label`;
  focus-visible outlines are global — don't remove them.

## Voice & copy

- Plain, concise, honest. Short sentences. Em-dashes for asides.
- **Write for a pan-European, non-native-English audience** — avoid US-native idioms and
  unexplained jargon. Prefer a clear heading ("The AI model") over insider terms
  ("Inference"). Name concrete things (e.g. the actual model, `mistral-small-3.2-24b-instruct-2506`).
- Be honest about limitations rather than overclaiming (mirrors `deploy-chat.md`'s tone).
- Don't let two sections contradict each other (e.g. "nothing is kept" vs. an opt-in
  logging box).

## Local dev — the gotcha that wastes time

`./scripts/run-local.sh` does **not** serve `chat/` directly. It copies `chat/` into a
**temp dir** (`$TMPDIR/ose-local-logs/chat-site`), rewrites `config.js` to point at the
local function/MCP ports, and serves that copy. Consequences:

1. **Edits require a server restart** to be re-copied (the script `rm -rf`s and re-copies
   on each run, so a restart always picks up your latest changes).
2. **The browser caches `app.js`/`styles.css`.** After a restart, symptoms like "I clicked
   the button and nothing happens, no console errors" almost always mean a stale cached
   `app.js` (new `index.html` has the button; old `app.js` never wired it). **Hard-reload**
   (⌘⇧R) to fix.
3. **`chat/config.js` in the repo is the *deployed* config — leave it untouched.**
   `run-local.sh` generates its own; CI renders the production one from repo variables.

## Verifying a UI change

Confirm a change actually renders and interactions work — don't trust "the file saved" or a
code read (a missing element or a null `addEventListener` silently aborts `app.js` and takes
down unrelated controls; only a real browser catches it).

**Render check (screenshot):** serve `chat/` and screenshot with headless Chrome. To shoot a
panel that starts `hidden`, copy `index.html` and strip the `hidden` attribute in the copy:

```sh
python3 -m http.server 8799 --directory chat &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --window-size=1200,900 \
  --screenshot=/tmp/chat.png http://localhost:8799/
```

**Interaction check (real click):** screenshots can't prove a toggle works. Drive Chrome over
the DevTools Protocol. If `puppeteer`/`playwright` isn't installed, use Node's built-in
`WebSocket` against `--remote-debugging-port` (no dependencies):

```sh
"$CHROME" --headless=new --remote-debugging-port=9333 --user-data-dir="$(mktemp -d)" about:blank &
node -e '
  const http=require("http");
  const get=p=>new Promise(r=>http.get({port:9333,path:p},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>r(JSON.parse(d)))}));
  (async()=>{
    const t=(await get("/json/list")).find(x=>x.type==="page");
    const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0,p={};
    const s=(m,q={})=>new Promise(r=>{const i=++id;p[i]=r;ws.send(JSON.stringify({id:i,method:m,params:q}))});
    await new Promise(r=>ws.onopen=r);
    ws.onmessage=e=>{const m=JSON.parse(e.data);if(p[m.id]){p[m.id](m.result);delete p[m.id]}};
    await s("Page.navigate",{url:"http://localhost:8799/"}); await new Promise(r=>setTimeout(r,1500));
    const ev=async x=>(await s("Runtime.evaluate",{expression:x,returnByValue:true})).result.value;
    await ev(`document.getElementById("sovToggle").click()`);
    console.log("panel open:", await ev(`!document.getElementById("sovPanel").hasAttribute("hidden")`));
    process.exit(0);
  })();
'
```

Capture `Runtime.exceptionThrown` too — a clean load with no exceptions is part of the pass.
