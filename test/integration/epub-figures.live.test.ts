// Live EPUB figure scan over real library books (#78 acceptance). Skips unless the
// books exist on this machine — publisher coverage: O'Reilly (Khononov), Packt
// (Tinderholt), pandoc (Lambert: separator-less h5 captions + hundreds of
// uncaptioned equation images that must stay hidden).

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FigureInventoryService } from "../../src/calibre/figure-inventory.js";
import { loadConfig } from "../../src/config.js";

const LIB = `${process.env.HOME}/Documents/Books/Programming Books`;
const BOOKS = {
  oreilly: `${LIB}/Vlad Khononov/Learning Domain-Driven Design (755)/Learning Domain-Driven Design - Vlad Khononov.epub`,
  packt: `${LIB}/Mark Tinderholt/Mastering Terraform_ A Practical Guide to Building and Deploying Infrastructure on AWS, Azure, (547)/Mastering Terraform_ A Practical Guide to - Mark Tinderholt.epub`,
  pandoc: `${LIB}/Nathan Lambert/The RLHF Book (509)/The RLHF Book - Nathan Lambert.epub`,
};

const svc = new FigureInventoryService(loadConfig({}));
const ready = svc.unzipBinary() !== null && Object.values(BOOKS).every(existsSync);

describe.skipIf(!ready)("EPUB figure inventory (live library files)", () => {
  it("finds captioned figures in an O'Reilly EPUB", { timeout: 60_000 }, async () => {
    const unzip = svc.unzipBinary();
    if (!unzip) return;
    const inv = await svc.scanEpubFile(unzip, BOOKS.oreilly);
    expect(inv.counts.figures).toBeGreaterThan(50); // book is diagram-dense
    const fig = inv.entries.find((e) => e.captioned);
    expect(fig?.label).toMatch(/^\d+-\d+$/);
    expect(fig?.imageHref).toMatch(/^images\//);
    expect(fig?.spineHref).toMatch(/\.html$/);
  });

  it("finds en-dash captions in a Packt EPUB", { timeout: 60_000 }, async () => {
    const unzip = svc.unzipBinary();
    if (!unzip) return;
    const inv = await svc.scanEpubFile(unzip, BOOKS.packt);
    expect(inv.counts.figures).toBeGreaterThan(20);
    expect(inv.entries.some((e) => e.caption?.length)).toBe(true);
  });

  it("parses pandoc separator-less h5 captions; equation images stay uncaptioned", { timeout: 60_000 }, async () => {
    const unzip = svc.unzipBinary();
    if (!unzip) return;
    const inv = await svc.scanEpubFile(unzip, BOOKS.pandoc);
    expect(inv.counts.figures).toBeGreaterThan(15);
    const fig = inv.entries.find((e) => e.captioned && e.imageHref?.endsWith("rl.png"));
    expect(fig).toMatchObject({ label: "4.1", caption: "Standard RL loop" });
    expect(inv.counts.uncaptioned).toBeGreaterThan(300); // the equations are all there, hidden
  });
});
