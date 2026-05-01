import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const MIRROR_DIR = path.join(ROOT, "cirubla.github.io");
const OUT_DIR = path.join(ROOT, "search-index");
const AUTHOR_NAME = "编程随想";

const TEXT_LIMIT = 60_000;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function decodeHtml(input = "") {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html = "") {
  return decodeHtml(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSearchText(input = "") {
  return String(input).toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function truncateText(text) {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n[...正文过长，已截断用于搜索...]` : text;
}

function extractPostText(article) {
  const file = path.join(MIRROR_DIR, article.url);
  if (!fs.existsSync(file)) return "";

  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf('<div class="post">');
  if (start < 0) return "";

  const commentsStart = html.indexOf('<div class="comments" id="comments"', start);
  const postHtml = commentsStart > start ? html.slice(start, commentsStart) : html.slice(start);
  return truncateText(htmlToText(postHtml));
}

function decodeCommentFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(/atob\('([^']+)'\)/);
  if (!match) return [];

  const inflated = zlib.gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
  const json = JSON.parse(inflated);
  if (Array.isArray(json)) return json;
  return json.feed?.entry || [];
}

function getAuthorName(entry) {
  return entry.author?.[0]?.name?.$t || "";
}

function getCommentId(entry) {
  const alternate = entry.link?.find((item) => item.rel === "alternate")?.href || "";
  const localId = alternate.match(/[?&](?:comment|showComment)=(\d+)/)?.[1];
  if (localId) return localId;

  const self = entry.link?.find((item) => item.rel === "self")?.href || "";
  return self.match(/\/default\/(\d+)\?v=2$/)?.[1] || "";
}

function getCommentTime(entry) {
  const display = entry.gd$extendedProperty?.find((item) => item.name === "blogger.displayTime")?.value;
  return display || entry.published?.$t || "";
}

function getLocalCommentUrl(article, entry) {
  const localId = getCommentId(entry);
  return localId ? `cirubla.github.io/${article.url}?comment=${localId}` : `cirubla.github.io/${article.url}#comments`;
}

function addDoc(shards, year, doc) {
  const bucket = shards.get(year) || [];
  bucket.push(doc);
  shards.set(year, bucket);
}

function build() {
  const articles = readJson(path.join(MIRROR_DIR, "articles.json"));
  const shards = new Map();
  const posts = [];
  const stats = {
    posts: 0,
    comments: 0,
    skippedCommentsByOtherAuthors: 0,
    missingCommentDirs: 0,
  };

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const article of articles) {
    const year = String(new Date(article.timestamp).getFullYear());
    const title = decodeHtml(article.title);
    const post = {
      id: `post:${article.postID}`,
      type: "post",
      postID: article.postID,
      title,
      postTitle: title,
      year,
      date: article.postTime || article.timestamp.slice(0, 10),
      url: `cirubla.github.io/${article.url}`,
      text: extractPostText(article),
    };

    posts.push({
      postID: article.postID,
      title,
      year,
      date: post.date,
      url: post.url,
      commentCount: article.initNum || 0,
    });
    addDoc(shards, year, post);
    stats.posts += 1;

    const commentDir = path.join(MIRROR_DIR, "comments", article.postID);
    if (!fs.existsSync(commentDir)) {
      stats.missingCommentDirs += 1;
      continue;
    }

    const files = fs.readdirSync(commentDir).filter((name) => name.endsWith(".js")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    for (const file of files) {
      const entries = decodeCommentFile(path.join(commentDir, file));
      for (const entry of entries) {
        const author = getAuthorName(entry);
        if (author !== AUTHOR_NAME) {
          stats.skippedCommentsByOtherAuthors += 1;
          continue;
        }

        const commentId = getCommentId(entry);
        const text = truncateText(htmlToText(entry.content?.$t || ""));
        if (!text) continue;

        addDoc(shards, year, {
          id: `comment:${article.postID}:${commentId}`,
          type: "comment",
          postID: article.postID,
          commentID: commentId,
          title: `评论：${title}`,
          postTitle: title,
          year,
          date: getCommentTime(entry),
          author,
          url: getLocalCommentUrl(article, entry),
          text,
        });
        stats.comments += 1;
      }
    }
  }

  const years = [...shards.keys()].sort((a, b) => Number(b) - Number(a));
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "cirubla.github.io",
    commentAuthorFilter: AUTHOR_NAME,
    years: [],
    posts,
    stats,
  };

  for (const year of years) {
    const docs = shards.get(year);
    const outFile = path.join(OUT_DIR, `${year}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ year, docs }), "utf8");
    manifest.years.push({
      year,
      file: `${year}.json`,
      docs: docs.length,
      posts: docs.filter((doc) => doc.type === "post").length,
      comments: docs.filter((doc) => doc.type === "comment").length,
      bytes: fs.statSync(outFile).size,
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

build();
