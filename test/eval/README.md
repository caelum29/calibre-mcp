# Eval suite (reserved)

Golden-prompt tool-selection evals (DESIGN §9.4) live here — a small set asserting the
*model* picks the right tool with the right args (e.g. "find me books about Rust ownership"
→ `calibre_semantic_search`; "ISBN 978… details" → `calibre_search`). Deferred until more
tools land; this folder reserves the home so the CI quality gate has a place to grow.
