#!/usr/bin/env python3
# PyMuPDF (fitz) text extractor. Invoked as: python3 pymupdf_extract.py <src> <dest>.
# Both paths are server-controlled temp files (never model input) — no shell, no eval.
# Writes UTF-8 plain text; preserves Cyrillic. Exits non-zero on any failure.
import sys


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("usage: pymupdf_extract.py <src> <dest>\n")
        return 2
    src, dest = sys.argv[1], sys.argv[2]
    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.stderr.write("PyMuPDF (fitz) not installed\n")
        return 3
    try:
        doc = fitz.open(src)
        parts = [page.get_text("text") for page in doc]
        doc.close()
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write("\n".join(parts))
    except Exception as exc:  # noqa: BLE001 — surface any extraction failure as non-zero
        sys.stderr.write(f"extraction failed: {exc}\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
