// Real pdftotext page snippets behind the #107 caption-quality quirks (probe 2026-10-21,
// poppler pdftotext -enc UTF-8, page breaks dropped). Each fixture is the minimal run of
// lines that reproduces one quirk; `expected` is the scan outcome the #107 fix must give.

/** One page of extracted text plus the captions a correct scan finds on it. */
export interface CaptionQuirkFixture {
  /** Book id + page in the "Programming Books" library the snippet was cut from. */
  source: string;
  page: string;
  expected: Array<{ label: string; text: string }>;
}

/**
 * Item 2 — mid-clause truncation (book 175, p.36). The caption wraps; the scan kept only
 * its first line ("…structure of the Linux kernel and the"). Continuation starts lowercase.
 */
export const WRAPPED_CAPTION: CaptionQuirkFixture = {
  source: "175 p.36",
  page: [
    "Architecture specific code",
    "",
    "Figure 1-1: High-level overview of the structure of the Linux kernel and the",
    "layers in a complete Linux system.",
    "",
    "1.3.1 Processes, Task Switching, and Scheduling",
  ].join("\n"),
  expected: [
    { label: "1-1", text: "High-level overview of the structure of the Linux kernel and the layers in a complete Linux system." },
  ],
};

/**
 * Item 2 — wrapped caption followed by body text with NO blank line between (book 175,
 * p.40). Joining must stop at the caption's terminal period, not swallow the paragraph.
 */
export const WRAPPED_CAPTION_THEN_BODY: CaptionQuirkFixture = {
  source: "175 p.40",
  page: [
    "0",
    "",
    "Figure 1-3: Division of virtual",
    "address space.",
    "Every user process in the system has its own virtual address range that extends from 0 to TASK_SIZE.",
  ].join("\n"),
  expected: [{ label: "1-3", text: "Division of virtual address space." }],
};

/**
 * Item 1 — empty caption that is an in-text reference (book 175, p.837). The referring
 * sentence wrapped past a blank line, so the #116 previous-line guard sees "" and passes
 * "Figure 12-32." (the `.` ends the sentence). The real caption follows on the same page.
 */
export const LABEL_ONLY_REFERENCE: CaptionQuirkFixture = {
  source: "175 p.837",
  page: [
    "sys_socket is the starting point for creating a new socket. The associated code flow diagram is shown in",
    "",
    "Figure 12-32.",
    "sys_socket",
    "sock_create",
    "",
    "Figure 12-32: Code flow diagram for sys_socket.",
    "First, a new socket data structure is created using sock_create, which directly calls __sock_create. The",
  ].join("\n"),
  expected: [{ label: "12-32", text: "Code flow diagram for sys_socket." }],
};

/**
 * Item 1 — empty caption that is a real figure (book 175, p.767): a narrow side-column
 * caption whose text starts on the line after the label.
 */
export const LABEL_THEN_TEXT_COLUMN: CaptionQuirkFixture = {
  source: "175 p.767",
  page: ["B", "", "Figure 12-2:", "Network-linked", "computers.", "1 Predominantly coaxial cable, twisted-pair cable"].join(
    "\n",
  ),
  expected: [{ label: "12-2", text: "Network-linked computers." }],
};

/**
 * Item 3 — body-text false positive that steals a raster (book 610, p.586). "(см." ends in
 * a period, so the #116 guard passes the wrapped reference "рис. 11.10) или…"; per-page
 * in-order pairing then gives the page's only raster to it, and the real caption below
 * falls to page-render. Text opening on `)` is the referring sentence, never a caption.
 * U+F076 is a Wingdings separator glyph the publisher puts between label and text.
 */
export const RU_REFERENCE_STEALS_RASTER: CaptionQuirkFixture = {
  source: "610 p.586",
  page: [
    "запросов напрямую использует локальные интерфейсы склада данных (см.",
    "рис. 11.10) или, в случае HDFS, может взаимодействовать с такой системой",
    "обработки данных, как MapReduce или Spark.",
    "HDFS",
    "",
    "Рис. 11.10  Полихранилище с сильно связанной архитектурой",
    "",
  ].join("\n"),
  expected: [{ label: "11.10", text: "Полихранилище с сильно связанной архитектурой" }],
};

/**
 * Item 3 (control sample) — RU in-text reference at a page top after a running header
 * (book 503, p.172): lowercase "рис." followed by lowercase prose. RU captions start
 * capitalized; the #116 guard can't see across the page break.
 */
export const RU_REFERENCE_AT_PAGE_TOP: CaptionQuirkFixture = {
  source: "503 p.172",
  page: [
    "171",
    "",
    "рис. 3.18 наглядно видно, что линейная регрессия в данном случае",
    "превосходит метод KNN. Зеленой сплошной линией, выведенной как",
  ].join("\n"),
  expected: [],
};

/**
 * Item 5 — two-line bare label (book 165, p.81; OCR'd scan, every figure looks like this).
 * No separator on the label line, so no pattern matches and the book reports 0 figures.
 * Caption text is Title Case, so continuation can't rely on a lowercase start.
 */
export const BARE_LABEL_BLOCK: CaptionQuirkFixture = {
  source: "165 p.81",
  page: [
    "WB",
    "",
    "Figure 2.10",
    "Unifying of ALU, Load, Store, and Branch Instruction Types into a Six-Stage Instruction Pipeline, Henceforth",
    "Identified as the TYPICAL (TYP) Instruction Pipeline.",
    "",
  ].join("\n"),
  expected: [
    {
      label: "2.10",
      text: "Unifying of ALU, Load, Store, and Branch Instruction Types into a Six-Stage Instruction Pipeline, Henceforth Identified as the TYPICAL (TYP) Instruction Pipeline.",
    },
  ],
};

/** Item 5 — Title Case continuation after a dangling "of" (book 165, p.46). */
export const BARE_LABEL_TITLE_CASE_WRAP: CaptionQuirkFixture = {
  source: "165 p.46",
  page: ["Figure 1.12", "Instruction Processing Profile of a Superscalar Machine of", "Degree n = 3.", ""].join("\n"),
  expected: [{ label: "1.12", text: "Instruction Processing Profile of a Superscalar Machine of Degree n = 3." }],
};

/**
 * Item 1 / 5 — a genuinely label-only figure (book 45, p.255, RU): the label sits under
 * the diagram with no caption text at all. It is still a Figure (the label anchors it),
 * so it stays captioned with empty text — the listing must say so instead of a blank cell.
 */
export const LABEL_ONLY_FIGURE: CaptionQuirkFixture = {
  source: "45 p.255",
  page: ["Фиксация", "", "Рис. 7.2", "", "HEAD", "master"].join("\n"),
  expected: [{ label: "7.2", text: "" }],
};

/**
 * Item 5 guard — a bare label followed by a lowercase line is a wrapped reference or a
 * diagram inner label, not a caption head (book 175, p.1070: "…is shown in\n\nFigure 18-3.").
 */
export const LABEL_THEN_DIAGRAM_LABEL: CaptionQuirkFixture = {
  source: "175 p.1070",
  page: [
    "setup_swap_extents is used to create the extent list. The associated code flow diagram is shown in",
    "",
    "Figure 18-3.",
    "setup_swap_extents",
    "Block device as swap area",
  ].join("\n"),
  expected: [],
};
