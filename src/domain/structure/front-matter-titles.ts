// The one front-matter title list (#625), shared by the heading rule (front-matter.ts) and the
// PDF-outline / EPUB-TOC chapter picker (pdf-outline.ts). A leaf module: chapters.ts,
// front-matter.ts and pdf-outline.ts import each other, so this one imports none of them.

// EN + RU/UK, written in normalised form (see `normalizeTitle`): lowercase, every run of
// non-letters/digits is one space — so "O'Reilly" is "o reilly" and "packt.com" is "packt com".
// Whole-title match, so "Preface" matches but "Prefaces in Kotlin" does not.
const FRONT_MATTER_TITLES = [
  // EN: cover/title/legal/praise/TOC
  "cover",
  "front cover",
  "inside front cover",
  "title",
  "title page",
  "half title",
  "front matter",
  "copyright",
  "copyright page",
  "copyright and credits",
  "credits",
  "dedication",
  "epigraph",
  "colophon",
  "praise",
  "praise for.*",
  "advance praise.*",
  "early praise.*",
  "endorsements",
  "what (?:people|readers|others) are saying.*",
  "also by .*",
  "other books .*",
  "books by .*",
  "contents",
  "table of contents",
  "brief contents",
  "contents at a glance",
  "contents in detail",
  "brief table of contents.*",
  "toc",
  "list of (?:figures|tables)",
  "revision history.*",
  // EN: foreword/preface and the publisher-boilerplate preface sections
  "forewords?(?: .*)?",
  "preface(?: .*)?",
  "author(?: s|s) note",
  "a note .*",
  "welcome",
  "acknowledg(?:e)?ments?",
  "contributors",
  "about the authors?.*",
  "about the (?:technical )?reviewers?.*",
  "about the contributors?",
  "about this book",
  "about the cover.*",
  "who (?:this book is for|should read this book).*",
  "who is this book for",
  "what you will learn",
  "how to (?:read|use) this book",
  "how this book is organized.*",
  "conventions(?: used)?(?: in this book)?",
  "using code examples",
  "o ?reilly (?:online learning|safari)",
  "safari.*",
  "how to contact us",
  "errata",
  "submitting errata",
  "get in touch",
  "download the example code files?",
  "why i wrote this book",
  "livebook discussion forum",
  "author online",
  "what ?s in (?:this|the) book",
  "a note about the code",
  "online resources",
  // EN: Packt/BPB preface boilerplate
  "why subscribe",
  "packt.*",
  "(?:www )?packtpub com",
  "customer feedback",
  "customer support",
  "reader feedback",
  "what you need for this book",
  "what this book covers",
  "(?:to get|getting) the most out of this book",
  "downloading the code",
  "download(?:ing)? the (?:example code(?: files)?|colou?r images)",
  "code bundle.*",
  "colou?red images",
  "piracy",
  "questions",
  "reviews",
  "share your thoughts",
  // RU/UK
  "обложка",
  "титул",
  "титульный лист",
  "оглавление",
  "содержание",
  "краткое содержание",
  "зміст",
  "предисловие.*",
  "передмова.*",
  "от автора",
  "от издательства",
  "від видавництва",
  "благодарности",
  "подяки",
  "посвящение",
  "присвята",
  "об автор.*",
  "про автор.*",
  "об этой книге",
  "о книге",
  "про книгу",
  "отзывы.*",
  "відгуки.*",
  "для кого эта книга",
  "условные обозначения",
  "о научн\\S* редактор.*",
  "о рецензент.*",
];

const FRONT_MATTER_TITLE = new RegExp(`^(?:${FRONT_MATTER_TITLES.join("|")})$`, "u");

/** NFKC, lowercase, every run of non-letters/digits → one space, trimmed. */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when a heading, outline or TOC title names a front-matter section (cover, copyright, preface…). */
export function isFrontMatterTitle(title: string): boolean {
  return FRONT_MATTER_TITLE.test(normalizeTitle(title));
}
