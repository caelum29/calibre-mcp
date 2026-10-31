/*@ Board shelf JS — renderShelf / renderShelfSkeleton / updateShelfPos + interactions (IIFE fragment). @*/
  /* ================= shelf rendering ================= */
  var strip = document.getElementById("strip"),
      prev = document.getElementById("prev"), next = document.getElementById("next");

  function renderShelf() {
    var books = payload.books;
    S.count = books.length;
    var frag = document.createDocumentFragment();
    books.forEach(function (b, i) {
      var title = String(b.title || "book " + b.bookId);
      var authors = (b.authors || []).join(", ");

      var li = el("li", "item");
      li.dataset.idx = String(i);

      var card = el("button", "card");
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-pressed", "false");
      card.dataset.id = String(b.bookId);
      card.tabIndex = i === 0 ? 0 : -1;
      card.appendChild(buildCover(b));
      card.appendChild(el("span", "t", title));
      card.appendChild(el("span", "a", authors || "\u00A0"));
      li.appendChild(card);

      // hover/focus action overlay — Open (never degrades) + Search inside (data-need="msg")
      var ov = el("span", "ov-stack");
      var open = el("button", "ov open");
      open.type = "button";
      open.dataset.open = String(b.bookId);
      open.setAttribute("aria-label", "Open " + title + " in local viewer");
      open.appendChild(openIcon());
      open.appendChild(el("span", null, "Open"));
      ov.appendChild(open);
      var si = el("button", "ov search");
      si.type = "button";
      si.dataset.searchin = String(b.bookId);
      si.dataset.need = "msg";
      si.setAttribute("aria-label", "Search this query inside " + title);
      si.appendChild(searchIcon());
      si.appendChild(el("span", null, "Search inside"));
      ov.appendChild(si);
      li.appendChild(ov);

      frag.appendChild(li);
    });
    strip.replaceChildren(frag);
    strip.scrollLeft = 0; S.focusIdx = 0; S.selected = null;
    updateShelfPos(); reportSize();
  }

  function renderShelfSkeleton() {
    var s = document.getElementById("skelStrip");
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 7; i++) {
      var li = el("li", "item skel");
      li.appendChild(el("div", "cover-s"));
      li.appendChild(el("div", "l1"));
      li.appendChild(el("div", "l2"));
      frag.appendChild(li);
    }
    s.replaceChildren(frag);
  }

  /* ================= position indicator + arrows ================= */
  function cardStep() { var it = strip.querySelector(".item"); return it ? it.offsetWidth + 14 : 148; }
  function updateShelfPos() {
    var n = S.count, vis = Math.max(1, Math.floor(strip.clientWidth / cardStep()));
    var first = Math.min(n - vis, Math.round(strip.scrollLeft / cardStep()));
    var a = Math.max(1, first + 1), b = Math.min(n, first + vis);
    if (S.variant === "shelf") pos.textContent = a + "\u2013" + b + " of " + n;
    var max = strip.scrollWidth - strip.clientWidth - 2;
    prev.disabled = strip.scrollLeft <= 2; next.disabled = strip.scrollLeft >= max;
  }
  strip.addEventListener("scroll", function () { requestAnimationFrame(updateShelfPos); });
  prev.addEventListener("click", function () { strip.scrollBy({ left: -strip.clientWidth + 40, behavior: "smooth" }); });
  next.addEventListener("click", function () { strip.scrollBy({ left: strip.clientWidth - 40, behavior: "smooth" }); });

  /* ================= interactions ================= */
  strip.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { e.stopPropagation(); openBook(+o.dataset.open); return; }
    var si = e.target.closest("[data-searchin]");
    if (si) { e.stopPropagation(); onSearchInside(+si.dataset.searchin); return; }
    var card = e.target.closest(".card"); if (!card) return;
    activateCard(strip, card);
  });
  strip.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    var d = e.key === "ArrowRight" ? 1 : -1;
    var cards = strip.querySelectorAll(".card");
    var ni = Math.max(0, Math.min(cards.length - 1, S.focusIdx + d));
    if (ni === S.focusIdx) return;
    cards[S.focusIdx].tabIndex = -1; cards[ni].tabIndex = 0;
    cards[ni].focus({ preventScroll: true }); S.focusIdx = ni;
    var it = cards[ni].closest(".item"), L = it.offsetLeft - strip.offsetLeft;
    if (L < strip.scrollLeft + 18) strip.scrollTo({ left: L - 18, behavior: "smooth" });
    else if (L + it.offsetWidth > strip.scrollLeft + strip.clientWidth - 18)
      strip.scrollTo({ left: L + it.offsetWidth - strip.clientWidth + 18, behavior: "smooth" });
  });
  strip.addEventListener("focusin", function (e) {
    var card = e.target.closest(".card");
    if (card) S.focusIdx = +card.closest(".item").dataset.idx;
  });
