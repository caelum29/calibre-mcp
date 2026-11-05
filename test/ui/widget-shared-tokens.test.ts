// #271: the three widgets share ONE token file (src/ui/shared/tokens.css) and ONE JSON-RPC
// fragment (src/ui/shared/rpc.js), pulled in with {{include}}. Moving them must not change a
// single resolved value: each widget's tokens, resolved from its rendered <style> (shared file
// + local overrides, in cascade order), are pinned below as literals captured before the move.
// Board keeps local --scrim/--pagestack; figures keeps --plate*; extra tokens a widget gains from
// the shared file are allowed (unused there), a changed or lost one is not.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boardHtml } from "../../src/ui/board-html.js";
import { cardHtml } from "../../src/ui/card-html.js";
import { figuresHtml } from "../../src/ui/figures-html.js";

type Tokens = Record<string, string>;
type Context = "base" | "dark theme" | "dark media";

/** Custom properties a `:root` rule set gives in `ctx`, applied in document order (last wins). */
function resolve(html: string, ctx: Context): Tokens {
  const css = html.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Tokens = {};
  const rule = /(:root(?:\[data-theme="(?:light|dark)"\]|:not\(\[data-theme="light"\]\))?)\s*\{([^{}]*)\}/g;
  for (const m of css.matchAll(rule)) {
    const sel = m[1]!;
    const applies =
      sel === ":root" ||
      (ctx === "dark theme" && sel === ':root[data-theme="dark"]') ||
      (ctx === "dark media" && sel.startsWith(":root:not"));
    if (!applies) continue;
    for (const d of m[2]!.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) out[`--${d[1]}`] = d[2]!.replace(/\s+/g, " ").trim();
  }
  return out;
}

const CORE: Tokens = {
  "--bg": "light-dark(#faf7f2, #262624)",
  "--tx": "light-dark(#33302b, #ece9e3)",
  "--tx-muted": "light-dark(#8a8378, #9c958a)",
  "--card": "light-dark(#ffffff, #31302e)",
  "--line": "light-dark(rgba(60,50,40,.14), rgba(255,255,255,.13))",
  "--accent": "light-dark(#c67139, #d98d55)",
  "--accent-deep": "light-dark(#8f4c20, #e8ab7d)",
  "--accent-tint": "light-dark(rgba(198,113,57,.12), rgba(217,141,85,.16))",
  "--btn": "light-dark(rgba(255,255,255,.94), rgba(49,48,46,.94))",
  "--skel": "light-dark(rgba(60,50,40,.08), rgba(255,255,255,.07))",
  "--skel-hi": "light-dark(rgba(255,255,255,.65), rgba(255,255,255,.09))",
  "--shadow": "0 1px 2px rgba(0,0,0,.07), 0 5px 16px rgba(0,0,0,.09)",
  "--shadow-lg": "0 2px 4px rgba(0,0,0,.09), 0 10px 26px rgba(0,0,0,.14)",
};
const SAGE: Tokens = {
  "--sage": "light-dark(#7a8a5e, #95a67a)",
  "--sage-tint": "light-dark(rgba(122,138,94,.14), rgba(149,166,122,.16))",
};
// book-volume + generated-cover knobs (board and card)
const BOOK: Tokens = {
  "--spine": "light-dark(rgba(0,0,0,.16), rgba(0,0,0,.42))",
  "--crease": "light-dark(rgba(255,255,255,.55), rgba(255,255,255,.14))",
  "--sheen": "light-dark(rgba(255,255,255,.26), rgba(255,255,255,.05))",
  "--pages": "light-dark(#f1ebe0, #46453f)",
  "--pages-line": "light-dark(#d8d0c2, #2c2b28)",
  "--cov-l": "84%",
  "--cov-l2": "73%",
  "--cov-c": ".05",
  "--cov-c2": ".075",
  "--cov-tx-l": "29%",
  "--cov-tx-c": ".055",
  "--cov-line": "rgba(0,0,0,.10)",
  "--cov-shine": "rgba(255,255,255,.35)",
};
const BOOK_DARK: Tokens = {
  "--cov-l": "39%",
  "--cov-l2": "30%",
  "--cov-c": ".045",
  "--cov-c2": ".06",
  "--cov-tx-l": "91%",
  "--cov-tx-c": ".03",
  "--cov-line": "rgba(255,255,255,.12)",
  "--cov-shine": "rgba(255,255,255,.08)",
};
const PLATE: Tokens = {
  "--plate": "light-dark(#ffffff, #e9e4db)",
  "--plate-edge": "light-dark(rgba(60,50,40,.15), rgba(0,0,0,.5))",
  "--plate-mat": "light-dark(#f3ece1, #2c2b28)",
};
const SCRIM_88 = "light-dark(rgba(255,253,250,.88), rgba(38,38,36,.88))";
const SCRIM_92 = "light-dark(rgba(255,253,250,.92), rgba(38,38,36,.92))";

const EXPECTED: Record<string, { base: Tokens; dark: Tokens }> = {
  board: {
    base: {
      ...CORE,
      ...BOOK,
      "--scrim": SCRIM_88,
      "--pagestack":
        "1.5px 0 0 var(--pages), 2.5px 0 0 var(--pages-line), 4px 0 0 var(--pages), 5px 0 0 var(--pages-line)",
    },
    dark: BOOK_DARK,
  },
  card: {
    base: {
      ...CORE,
      ...SAGE,
      ...BOOK,
      "--scrim": SCRIM_92,
      "--pagestack":
        "2px 0 0 var(--pages), 3.5px 0 0 var(--pages-line), 5.5px 0 0 var(--pages), 7px 0 0 var(--pages-line)",
    },
    dark: BOOK_DARK,
  },
  figures: { base: { ...CORE, ...SAGE, ...PLATE, "--scrim": SCRIM_92 }, dark: {} },
};

const RENDERS: [name: string, expected: keyof typeof EXPECTED, html: () => string][] = [
  ["board shelf", "board", () => boardHtml("calibre_search", "9.9.9", "shelf", false)],
  ["board coverflow", "board", () => boardHtml("calibre_search", "9.9.9", "coverflow", false)],
  ["card", "card", () => cardHtml("9.9.9", false)],
  ["figures", "figures", () => figuresHtml("9.9.9", false)],
];

const pick = (all: Tokens, keys: string[]): Tokens =>
  Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]!]));

describe("widget design tokens resolve to their pre-move values (#271)", () => {
  it.each(RENDERS)("should_keep_every_%s_token_value_in_light", (_n, which, html) => {
    const want = EXPECTED[which]!.base;
    expect(pick(resolve(html(), "base"), Object.keys(want))).toEqual(want);
  });

  it.each(RENDERS)("should_keep_every_%s_token_value_under_the_dark_theme_attribute", (_n, which, html) => {
    const want = { ...EXPECTED[which]!.base, ...EXPECTED[which]!.dark };
    expect(pick(resolve(html(), "dark theme"), Object.keys(want))).toEqual(want);
  });

  it.each(RENDERS)("should_keep_every_%s_token_value_under_the_dark_media_query", (_n, which, html) => {
    const want = { ...EXPECTED[which]!.base, ...EXPECTED[which]!.dark };
    expect(pick(resolve(html(), "dark media"), Object.keys(want))).toEqual(want);
  });
});

const src = (rel: string): string => readFileSync(new URL(`../../src/ui/${rel}`, import.meta.url), "utf8");

describe("widgets pull their tokens and JSON-RPC plumbing from shared fragments (#271)", () => {
  it("should_declare_the_palette_once_in_shared_tokens_css", () => {
    const tokens = src("shared/tokens.css");
    for (const name of Object.keys({ ...CORE, ...SAGE, ...BOOK })) expect(tokens).toContain(`${name}:`);
  });

  it.each([["board/shell.css"], ["card/card.css"], ["figures/figures.css"]])(
    "should_include_shared_tokens_css_and_not_redeclare_the_palette_in_%s",
    (file) => {
      const css = src(file);
      expect(css).toContain("{{include ../shared/tokens.css}}");
      expect(css).not.toContain("--bg:");
    },
  );

  it("should_define_the_json_rpc_helpers_once_in_shared_rpc_js", () => {
    const rpc = src("shared/rpc.js");
    for (const fn of ["rpcRequest", "rpcNotify", "rpcRespond", "applyHostContext"]) {
      expect(rpc).toContain(`function ${fn}(`);
    }
  });

  it.each([["board/core.js"], ["card/card.js"], ["figures/figures.js"]])(
    "should_include_shared_rpc_js_and_not_redefine_the_helpers_in_%s",
    (file) => {
      const js = src(file);
      expect(js).toContain("{{include ../shared/rpc.js}}");
      expect(js).not.toContain("function rpcRequest(");
      expect(js).not.toContain("function applyHostContext(");
    },
  );

  it.each(RENDERS)("should_render_the_helpers_exactly_once_in_%s", (_n, _w, html) => {
    const out = html();
    for (const fn of ["rpcRequest", "rpcNotify", "rpcRespond", "applyHostContext"]) {
      expect(out.split(`function ${fn}(`)).toHaveLength(2);
    }
  });
});
