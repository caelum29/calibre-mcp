// EPUB TOC reader (#135): unzips the downloaded EPUB, walks container.xml → OPF → nav/NCX +
// spine (the same path the figure scan walks), and anchors each spine document in the
// already-extracted text. A best-effort chapter source — every failure degrades to null
// (text detectors), never fails extraction.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { parseContainerRootfile, parseOpfSpine } from "../domain/figures/epub.js";
import {
  anchorSpineDocs,
  type EpubToc,
  parseNavToc,
  parseNcxToc,
  parseOpfTocRefs,
  pickToc,
  type SpineHtml,
} from "../domain/structure/epub-toc.js";
import { log } from "../logging.js";
import { spawnCollect } from "./spawn.js";

// EPUB = zip; system unzip is universal on macOS/Linux, keeps the zero-new-deps rule.
const UNZIP_CANDIDATES = ["/usr/bin/unzip", "/opt/homebrew/bin/unzip", "/usr/local/bin/unzip"];
const UNZIP_TIMEOUT_MS = 30_000;

/** System unzip, or null when missing (never on macOS; minimal Linux images only). */
export function unzipBinary(): string | null {
  return UNZIP_CANDIDATES.find(existsSync) ?? null;
}

export interface ReadEpubTocOptions {
  /** Directory the EPUB is unzipped under (a per-call subdir, removed afterwards). */
  scratchRoot: string;
  signal?: AbortSignal;
}

/**
 * Read an EPUB's TOC and anchor its spine documents in `text` (the final extracted text, so
 * anchors share its char coordinates). Never throws: no unzip, a DRM/corrupt zip, or a
 * missing TOC → null.
 */
export async function readEpubToc(
  unzip: string,
  src: string,
  text: string,
  { scratchRoot, signal }: ReadEpubTocOptions,
): Promise<EpubToc | null> {
  const dir = path.join(scratchRoot, `ep-${randomUUID()}`);
  try {
    // `unzip -d` creates only ONE missing level — own the dir (see figure-inventory.ts).
    await mkdir(dir, { recursive: true });
    // -o overwrite, -qq silent; unzip refuses paths escaping -d. Exit 1 = warnings only.
    const { code } = await spawnCollect(unzip, ["-o", "-qq", src, "-d", dir], {
      timeoutMs: UNZIP_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      signal,
    });
    if (code !== 0 && code !== 1) return null;
    const readInside = async (href: string): Promise<string | null> => {
      const abs = path.resolve(dir, href);
      if (!abs.startsWith(path.resolve(dir) + path.sep)) return null;
      return readFile(abs, "utf8").catch(() => null);
    };

    const container = await readInside("META-INF/container.xml");
    const opfPath = container ? parseContainerRootfile(container) : null;
    const opf = opfPath ? await readInside(opfPath) : null;
    if (!opfPath || !opf) return null;

    const refs = parseOpfTocRefs(opf, opfPath);
    const navXml = refs.nav ? await readInside(refs.nav) : null;
    const ncxXml = refs.ncx ? await readInside(refs.ncx) : null;
    const entries = pickToc(
      navXml && refs.nav ? parseNavToc(navXml, refs.nav) : [],
      ncxXml && refs.ncx ? parseNcxToc(ncxXml, refs.ncx) : [],
    );
    if (entries.length === 0) return null;

    const docs: SpineHtml[] = [];
    for (const href of parseOpfSpine(opf, opfPath)) {
      if (!/\.(x?html?|xml)$/i.test(href)) continue;
      const html = await readInside(href);
      if (html !== null) docs.push({ href, html });
    }
    return { entries, anchors: anchorSpineDocs(text, docs) };
  } catch (err) {
    log.warn("epub toc unavailable", { msg: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
