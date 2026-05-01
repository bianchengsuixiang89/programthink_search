const state = {
  manifest: null,
  shards: new Map(),
  shardPromises: new Map(),
  activeType: "all",
  results: [],
  terms: [],
  page: 1,
  debounceTimer: null,
  searchSeq: 0,
};

const els = {
  query: document.querySelector("#query"),
  searchButton: document.querySelector("#searchButton"),
  yearFilter: document.querySelector("#yearFilter"),
  postFilter: document.querySelector("#postFilter"),
  pageSize: document.querySelector("#pageSize"),
  summary: document.querySelector("#summary"),
  indexStats: document.querySelector("#indexStats"),
  results: document.querySelector("#results"),
  pager: document.querySelector("#pager"),
  typeButtons: [...document.querySelectorAll("[data-type]")],
};

function normalize(input) {
  return String(input || "").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTerms(query) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

function getCompactText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function getMatchText(doc) {
  if (!doc._matchText) {
    const parts = doc.type === "post" ? [doc.title, doc.text] : [doc.text];
    doc._matchText = normalize(parts.filter(Boolean).join("\n"));
  }
  return doc._matchText;
}

function getSnippet(doc, terms) {
  const text = doc.type === "comment" ? String(doc.text || "").trim() : getCompactText(doc.text);
  if (!text) return "";

  if (doc.type === "comment") return text;

  const normalizedText = normalize(text);
  let pos = -1;
  for (const term of terms) {
    pos = normalizedText.indexOf(term);
    if (pos >= 0) break;
  }

  if (pos < 0) return text.slice(0, 220);

  const start = Math.max(0, pos - 80);
  const end = Math.min(text.length, pos + 180);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function highlight(input, terms) {
  return highlightHtml(escapeHtml(input), terms);
}

function decodeAttribute(input) {
  return String(input || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sanitizeUrl(url) {
  const value = decodeAttribute(url).trim();
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (/^[./#?]/.test(value)) return value;
  return "";
}

function applyBbcode(html) {
  let output = html;
  output = output.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_, url, label) => {
    const safeUrl = sanitizeUrl(url);
    return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_self" rel="noopener noreferrer">${label}</a>` : label;
  });
  output = output.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, url) => {
    const safeUrl = sanitizeUrl(url);
    const label = escapeHtml(decodeAttribute(url));
    return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_self" rel="noopener noreferrer">${label}</a>` : label;
  });
  return output
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>")
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, "<s>$1</s>");
}

function highlightHtml(html, terms) {
  const uniqueTerms = [...new Set(terms)].sort((a, b) => b.length - a.length);
  return String(html).split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith("<")) return part;
    let text = part;
    for (const term of uniqueTerms) {
      if (!term) continue;
      text = text.replace(new RegExp(escapeRegExp(escapeHtml(term)), "gi"), (match) => `<mark>${match}</mark>`);
    }
    return text;
  }).join("");
}

function renderRichText(input, terms) {
  return highlightHtml(applyBbcode(escapeHtml(input)), terms);
}

function getPageSize() {
  return els.pageSize.value === "all" ? Infinity : Number(els.pageSize.value || 100);
}

function updateUrl() {
  const params = new URLSearchParams();
  if (els.query.value.trim()) params.set("q", els.query.value.trim());
  if (state.activeType !== "all") params.set("type", state.activeType);
  if (els.yearFilter.value !== "all") params.set("year", els.yearFilter.value);
  if (els.postFilter.value !== "all") params.set("post", els.postFilter.value);
  if (els.pageSize.value !== "100") params.set("size", els.pageSize.value);
  if (state.page > 1) params.set("page", String(state.page));
  location.hash = params.toString() ? `#/search?${params.toString()}` : "";
}

function readUrl() {
  const hash = location.hash.replace(/^#\/search\??/, "");
  const params = new URLSearchParams(hash);
  els.query.value = params.get("q") || "";
  state.activeType = params.get("type") || "all";
  els.yearFilter.value = params.get("year") || "all";
  els.postFilter.value = params.get("post") || "all";
  els.pageSize.value = params.get("size") || "100";
  state.page = Math.max(1, Number(params.get("page") || 1));
  els.typeButtons.forEach((button) => button.classList.toggle("active", button.dataset.type === state.activeType));
}

function populateFilters() {
  const years = state.manifest.years.map((item) => item.year);
  els.yearFilter.innerHTML = [
    '<option value="all">全部年份</option>',
    ...years.map((year) => `<option value="${year}">${year}</option>`),
  ].join("");

  const posts = [...state.manifest.posts].sort((a, b) => Number(b.year) - Number(a.year) || b.date.localeCompare(a.date));
  els.postFilter.innerHTML = [
    '<option value="all">全部文章</option>',
    ...posts.map((post) => `<option value="${escapeHtml(post.postID)}">${escapeHtml(post.year)} · ${escapeHtml(post.title)}</option>`),
  ].join("");
}

async function loadShard(year) {
  if (state.shards.has(year)) return state.shards.get(year);
  if (!state.shardPromises.has(year)) {
    state.shardPromises.set(year, fetch(`search-index/${year}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`加载 ${year} 索引失败`);
        return response.json();
      })
      .then((shard) => {
        state.shards.set(year, shard.docs);
        return shard.docs;
      }));
  }
  return state.shardPromises.get(year);
}

async function loadCandidateDocs() {
  const year = els.yearFilter.value;
  const years = year === "all" ? state.manifest.years.map((item) => item.year) : [year];
  const chunks = await Promise.all(years.map(loadShard));
  return chunks.flat();
}

function scoreDoc(doc, terms) {
  let score = doc.type === "post" ? 4 : 2;
  const matchText = getMatchText(doc);

  if (doc.type === "post") {
    const title = normalize(doc.title);
    for (const term of terms) {
      if (title.includes(term)) score += 28;
    }
  }

  for (const term of terms) {
    const first = matchText.indexOf(term);
    if (first >= 0) score += Math.max(1, 14 - Math.floor(first / 500));
  }
  return score;
}

function renderPager() {
  const pageSize = getPageSize();
  if (!state.results.length || pageSize === Infinity) {
    els.pager.innerHTML = "";
    return;
  }

  const pageCount = Math.max(1, Math.ceil(state.results.length / pageSize));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  els.pager.innerHTML = `
    <button type="button" data-page="prev" ${state.page <= 1 ? "disabled" : ""}>上一页</button>
    <span>第 ${state.page} / ${pageCount} 页</span>
    <button type="button" data-page="next" ${state.page >= pageCount ? "disabled" : ""}>下一页</button>
  `;
}

function renderCurrentPage(elapsed = null) {
  const pageSize = getPageSize();
  const total = state.results.length;

  if (!total) {
    els.summary.textContent = state.terms.length ? "没有找到匹配结果。" : "请输入关键词开始搜索。";
    els.results.innerHTML = '<div class="empty">没有结果</div>';
    els.pager.innerHTML = "";
    updateUrl();
    return;
  }

  if (pageSize !== Infinity) {
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    state.page = Math.min(Math.max(1, state.page), pageCount);
  }

  const start = pageSize === Infinity ? 0 : (state.page - 1) * pageSize;
  const end = pageSize === Infinity ? total : Math.min(total, start + pageSize);
  const shown = state.results.slice(start, end);
  const timing = elapsed === null ? "" : `，用时 ${elapsed} ms`;

  els.summary.textContent = `找到 ${total} 条结果，当前显示 ${start + 1}-${end}${timing}。`;
  els.results.innerHTML = shown.map((item, index) => {
    const resultIndex = start + index;
    const doc = item.doc;
    const snippet = getSnippet(doc, state.terms);
    const canExpand = doc.type === "post" && getCompactText(doc.text) !== snippet;
    const typeLabel = doc.type === "post" ? "博文" : "本人评论";
    const title = doc.type === "post" ? doc.title : doc.postTitle;
    return `
      <article class="result" data-result-index="${resultIndex}">
        <div class="result-meta">
          <span class="badge">${typeLabel}</span>
          <span>${escapeHtml(doc.date || doc.year)}</span>
          ${doc.type === "comment" ? `<span>作者：${escapeHtml(doc.author)}</span>` : ""}
        </div>
        <h2><a class="result-link" href="${escapeHtml(doc.url)}" target="_self">${highlight(title, state.terms)}</a></h2>
        <p class="snippet" data-expanded="${doc.type === "comment" ? "true" : "false"}">${renderRichText(snippet, state.terms)}</p>
        <div class="result-actions">
          ${canExpand ? '<button class="expand-button" type="button">展开</button>' : ""}
          ${doc.type === "comment" ? `<a class="source-link" href="${escapeHtml(doc.url)}" target="_self">跳到原博文评论位置</a>` : ""}
        </div>
      </article>
    `;
  }).join("");

  renderPager();
  updateUrl();
}

async function search({ keepPage = false } = {}) {
  const seq = ++state.searchSeq;
  const started = performance.now();
  state.terms = splitTerms(els.query.value);
  if (!keepPage) state.page = 1;

  if (!state.terms.length) {
    state.results = [];
    renderCurrentPage(0);
    return;
  }

  els.searchButton.disabled = true;
  els.summary.textContent = "正在加载并搜索索引...";

  try {
    const docs = await loadCandidateDocs();
    if (seq !== state.searchSeq) return;

    const postID = els.postFilter.value;
    const results = [];

    for (const doc of docs) {
      if (state.activeType !== "all" && doc.type !== state.activeType) continue;
      if (postID !== "all" && doc.postID !== postID) continue;
      const matchText = getMatchText(doc);
      if (state.terms.every((term) => matchText.includes(term))) {
        results.push({ doc, score: scoreDoc(doc, state.terms) });
      }
    }

    results.sort((a, b) => b.score - a.score || String(b.doc.date).localeCompare(String(a.doc.date)));
    state.results = results;
    renderCurrentPage(Math.round(performance.now() - started));
  } catch (error) {
    if (seq !== state.searchSeq) return;
    els.summary.textContent = error.message;
    els.results.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    els.pager.innerHTML = "";
  } finally {
    if (seq === state.searchSeq) els.searchButton.disabled = false;
  }
}

function scheduleSearch() {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => search(), 180);
}

function expandResult(article) {
  const index = Number(article.dataset.resultIndex);
  const button = article.querySelector(".expand-button");
  const snippet = article.querySelector(".snippet");
  const doc = state.results[index]?.doc;
  if (!doc || !button || !snippet) return;

  if (snippet.dataset.expanded !== "true") {
    snippet.innerHTML = renderRichText(String(doc.text || "").trim(), state.terms);
    snippet.dataset.expanded = "true";
    button.textContent = "收起";
  } else {
    snippet.innerHTML = renderRichText(getSnippet(doc, state.terms), state.terms);
    snippet.dataset.expanded = "false";
    button.textContent = "展开";
  }
}

async function init() {
  const response = await fetch("search-index/manifest.json");
  state.manifest = await response.json();
  populateFilters();
  readUrl();

  const totalBytes = state.manifest.years.reduce((sum, item) => sum + item.bytes, 0);
  els.indexStats.textContent = `${state.manifest.stats.posts} 篇博文，${state.manifest.stats.comments} 条本人评论，索引 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`;
  els.summary.textContent = "索引目录已加载。";

  els.searchButton.addEventListener("click", () => search());
  els.query.addEventListener("input", scheduleSearch);
  els.query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") search();
  });
  els.yearFilter.addEventListener("change", () => search());
  els.postFilter.addEventListener("change", () => search());
  els.pageSize.addEventListener("change", () => {
    state.page = 1;
    renderCurrentPage();
  });
  els.typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activeType = button.dataset.type;
      els.typeButtons.forEach((item) => item.classList.toggle("active", item === button));
      search();
    });
  });
  els.pager.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.page;
    if (!action) return;
    state.page += action === "next" ? 1 : -1;
    renderCurrentPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  els.results.addEventListener("click", (event) => {
    const button = event.target.closest(".expand-button");
    if (!button) return;
    expandResult(button.closest(".result"));
  });

  if (els.query.value.trim()) search({ keepPage: true });
}

init().catch((error) => {
  els.summary.textContent = error.message;
  els.results.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
});
