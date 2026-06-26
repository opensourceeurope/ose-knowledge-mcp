/* ============================================================
   OSE chat — ephemeral, sovereign static client.
   Conversation lives only in memory; nothing is persisted.
   ============================================================ */
(function () {
  "use strict";

  var CONFIG = window.OSE_CHAT_CONFIG || {};
  var FUNCTION_URL = CONFIG.FUNCTION_URL || "";

  // Ephemeral conversation (in-memory only).
  var conversation = [];

  var transcript = document.getElementById("transcript");
  var emptyState = document.getElementById("emptyState");
  var form = document.getElementById("composer");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var optIn = document.getElementById("analyticsOptIn");

  /* ---------- "Use it in your own tools" panel ---------- */
  var toolsToggle = document.getElementById("toolsToggle");
  var toolsPanel = document.getElementById("toolsPanel");

  toolsToggle.addEventListener("click", function () {
    var open = toolsPanel.hasAttribute("hidden");
    if (open) {
      toolsPanel.removeAttribute("hidden");
    } else {
      toolsPanel.setAttribute("hidden", "");
    }
    toolsToggle.setAttribute("aria-expanded", String(open));
    if (open) toolsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Copy-to-clipboard buttons.
  document.querySelectorAll(".btn--copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.getElementById(btn.getAttribute("data-copy"));
      if (!target) return;
      var text = target.textContent;
      var done = function () {
        var orig = btn.textContent;
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        setTimeout(function () {
          btn.textContent = orig;
          btn.classList.remove("is-copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
      } else {
        legacyCopy(text);
        done();
      }
    });
  });

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  /* ---------- Suggestion chips ---------- */
  document.querySelectorAll(".chip--suggest").forEach(function (chip) {
    chip.addEventListener("click", function () {
      input.value = chip.getAttribute("data-suggest") || chip.textContent;
      autosize();
      input.focus();
    });
  });

  /* ---------- Textarea autosize ---------- */
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }
  input.addEventListener("input", autosize);

  /* ---------- Rendering ---------- */
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function scrollToEnd() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function clearEmptyState() {
    if (emptyState && emptyState.parentNode) emptyState.parentNode.removeChild(emptyState);
  }

  // Index citations by their footnote number so the renderer can turn inline
  // [n] markers into superscript links: { "1": {url, title, ...}, ... }.
  function citesByNumber(citations) {
    var map = {};
    if (Array.isArray(citations)) {
      citations.forEach(function (c) {
        if (c && c.n != null) map[String(c.n)] = c;
      });
    }
    return map;
  }

  function renderMessage(role, content, cites) {
    var wrap = el("div", "msg msg--" + role);
    wrap.appendChild(el("span", "msg__role", role === "user" ? "You" : "OSE"));
    var bubble;
    if (role === "assistant" && window.OSE_MD) {
      // Answers are markdown; OSE_MD.render escapes all HTML before formatting.
      bubble = el("div", "msg__bubble msg__bubble--md");
      bubble.innerHTML = window.OSE_MD.render(content, cites);
    } else {
      bubble = el("div", "msg__bubble", content);
    }
    wrap.appendChild(bubble);
    transcript.appendChild(wrap);
    scrollToEnd();
    return wrap;
  }

  function renderCitations(parent, citations) {
    if (!Array.isArray(citations) || citations.length === 0) return;
    var box = el("div", "citations");
    box.appendChild(el("span", "citations__label", "Sources"));
    var row = el("div", "citations__row");
    citations.forEach(function (c, i) {
      if (!c || !c.url) return;
      // Footnote number ties this entry to the inline [n] markers in the prose.
      var num = c.n != null ? c.n : i + 1;
      var chip = el("a", "citation-chip");
      chip.appendChild(el("span", "citation-chip__n", String(num)));
      chip.appendChild(el("span", "citation-chip__label", c.title || c.source_name || c.url));
      if (c.title && c.source_name) chip.title = c.source_name; // hover shows which source
      chip.href = c.url;
      chip.target = "_blank";
      chip.rel = "noopener noreferrer";
      row.appendChild(chip);
    });
    if (row.children.length) {
      box.appendChild(row);
      parent.appendChild(box);
      scrollToEnd();
    }
  }

  function renderError(message) {
    var wrap = el("div", "msg msg--assistant");
    wrap.appendChild(el("span", "msg__role", "OSE"));
    var bubble = el("div", "msg__bubble msg__bubble--error", message);
    wrap.appendChild(bubble);
    transcript.appendChild(wrap);
    scrollToEnd();
  }

  /* ---------- Staged loader ---------- */
  function showLoader() {
    var loader = el("div", "loader");
    var bubble = el("div", "loader__bubble");
    var dots = el("span", "loader__dots");
    dots.appendChild(el("span"));
    dots.appendChild(el("span"));
    dots.appendChild(el("span"));
    var label = el("span", "loader__label", "Searching the OSE docs…");
    bubble.appendChild(dots);
    bubble.appendChild(label);
    loader.appendChild(bubble);
    transcript.appendChild(loader);
    scrollToEnd();

    var timer = setTimeout(function () {
      label.textContent = "Writing the answer…";
    }, 1400);

    return {
      done: function () {
        clearTimeout(timer);
        if (loader.parentNode) loader.parentNode.removeChild(loader);
      },
    };
  }

  /* ---------- Send ---------- */
  var inFlight = false;

  async function send(text) {
    if (inFlight) return;
    var question = (text != null ? text : input.value).trim();
    if (!question) return;

    clearEmptyState();
    renderMessage("user", question);
    conversation.push({ role: "user", content: question });

    input.value = "";
    autosize();
    inFlight = true;
    sendBtn.disabled = true;

    var loader = showLoader();

    try {
      if (!FUNCTION_URL) throw new Error("not_configured");

      var res = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: conversation.slice(),
          analyticsOptIn: !!optIn.checked,
        }),
      });

      loader.done();

      if (!res.ok) throw new Error("bad_status");

      var data = await res.json();
      var answer = (data && typeof data.answer === "string") ? data.answer : "";
      var citations = (data && Array.isArray(data.citations)) ? data.citations : [];

      if (!answer) throw new Error("empty_answer");

      var bubble = renderMessage("assistant", answer, citesByNumber(citations));
      renderCitations(bubble, citations);
      conversation.push({ role: "assistant", content: answer });
    } catch (err) {
      loader.done();
      renderError(
        "Sorry — I couldn't reach the OSE assistant just now. Please check your connection and try again in a moment."
      );
    } finally {
      inFlight = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* ---------- Events ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send();
  });

  // Enter sends; Shift+Enter inserts a newline.
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // Suggestion chips should send immediately on a second click path:
  // we set the input on first click (above); pressing Enter sends.
})();
