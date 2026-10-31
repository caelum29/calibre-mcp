/*@ Board coverflow JS — renderFlow / renderFlowSkeleton / layoutFlow + interactions (IIFE fragment). @*/
  /* ================= coverflow rendering ================= */
  var FSTEP = 70; // px of scroll per book (matches .fsnap width)
  var fscroll = document.getElementById("fscroll"), fstage = document.getElementById("fstage"),
      frow = document.getElementById("frow"), fprev = document.getElementById("fprev"),
      fnext = document.getElementById("fnext"), ft = document.getElementById("ft"),
      fa = document.getElementById("fa");
  var F = { n: 0, cur: 0, lastC: -1 };

  // 3D pose for an item e steps away from center (shared with the skeleton).
  function pose(e) {
    var k = Math.max(-1, Math.min(1, e)), ae = Math.abs(e);
    return {
      tf: "translateX(" + (e * 54 + k * 54) + "px) translateZ(" + ((1 - Math.abs(k)) * 80) + "px)" +
          " rotateY(" + (-k * 42) + "deg) scale(" + Math.max(0.55, 1 - Math.min(ae, 5) * 0.075) + ")",
      z: String(200 - Math.round(ae * 10)),
      op: String(Math.max(0, Math.min(1, 1 - (ae - 3.4) * 0.5)))
    };
  }

  function centerIdx() { return Math.max(0, Math.min(F.n - 1, Math.round(F.cur))); }

  function renderFlow() {
    var books = payload.books;
    F.n = books.length; F.lastC = -1; S.count = books.length;
    frow.style.paddingInline = (fscroll.clientWidth / 2 - FSTEP / 2) + "px";
    var snaps = document.createDocumentFragment();
    for (var i = 0; i < F.n; i++) snaps.appendChild(el("div", "fsnap"));
    frow.replaceChildren(snaps);
    var frag = document.createDocumentFragment();
    books.forEach(function (b, i) {
      var li = el("li", "fitem");
      li.dataset.idx = String(i);

      var card = el("button", "card");
      card.type = "button";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", "false");
      card.setAttribute("aria-pressed", "false");
      card.dataset.id = String(b.bookId);
      card.tabIndex = -1;
      card.appendChild(buildCover(b));
      li.appendChild(card);
      frag.appendChild(li);
    });
    fstage.replaceChildren(frag);
    fscroll.scrollLeft = 0;
    layoutFlow();
    reportSize();
  }

  function layoutFlow() {
    var cur = fscroll.scrollLeft / FSTEP; F.cur = cur;
    fstage.querySelectorAll(".fitem").forEach(function (item, i) {
      var p = pose(i - cur);
      item.style.transform = p.tf; item.style.zIndex = p.z; item.style.opacity = p.op;
    });
    var c = centerIdx();
    if (c !== F.lastC) {
      F.lastC = c;
      var b = payload.books[c];
      ft.textContent = String(b.title || "book " + b.bookId);
      fa.textContent = (b.authors || []).join(", ") || "\u2014";
    }
    fprev.disabled = cur <= 0.02; fnext.disabled = cur >= F.n - 1.02;
    if (S.variant === "coverflow") pos.textContent = (c + 1) + " of " + F.n;
  }

  function renderFlowSkeleton() {
    var s = document.getElementById("skelstage");
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 5; i++) {
      var p = pose(i - 2);
      var li = el("li", "fitem");
      li.style.transform = p.tf; li.style.zIndex = p.z;
      li.appendChild(el("div", "cover-s"));
      frag.appendChild(li);
    }
    s.replaceChildren(frag);
  }

  /* ================= interactions ================= */
  function selectCenter() {
    var c = centerIdx();
    var card = fstage.querySelector('.fitem[data-idx="' + c + '"] .card');
    if (card) activateCard(fstage, card);
  }
  fscroll.addEventListener("scroll", function () { requestAnimationFrame(layoutFlow); });
  fprev.addEventListener("click", function () { fscroll.scrollTo({ left: (Math.round(F.cur) - 1) * FSTEP, behavior: "smooth" }); });
  fnext.addEventListener("click", function () { fscroll.scrollTo({ left: (Math.round(F.cur) + 1) * FSTEP, behavior: "smooth" }); });
  fstage.addEventListener("click", function (e) {
    var li = e.target.closest(".fitem"); if (!li) return;
    var i = +li.dataset.idx;
    // Off-center click just scrolls that book to center; a centered click opens it.
    if (Math.round(F.cur) !== i) { fscroll.scrollTo({ left: i * FSTEP, behavior: "smooth" }); return; }
    selectCenter();
  });
  fscroll.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      var d = e.key === "ArrowRight" ? 1 : -1;
      fscroll.scrollTo({ left: (Math.round(F.cur) + d) * FSTEP, behavior: "smooth" });
    }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectCenter(); }
  });
  // Label-bar actions act on the centered book.
  document.getElementById("fopen").addEventListener("click", function () { openBook(payload.books[centerIdx()].bookId); });
  document.getElementById("fsearch").addEventListener("click", function () { onSearchInside(payload.books[centerIdx()].bookId); });
