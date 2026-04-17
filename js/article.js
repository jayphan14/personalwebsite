(async function () {
  const target = document.getElementById('article');
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug');

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    target.innerHTML = '<p class="muted">No article selected. <a href="./blog.html">Back to blog</a>.</p>';
    return;
  }

  let manifest;
  try {
    const r = await fetch('blog/manifest.json', { cache: 'no-cache' });
    manifest = await r.json();
  } catch (e) {
    target.innerHTML = `<p class="muted">Could not load manifest: ${escapeHtml(e.message)}</p>`;
    return;
  }

  const post = findPost(manifest, slug);
  if (!post) {
    target.innerHTML = '<p class="muted">Article not found.</p>';
    return;
  }

  document.title = `${post.title} — Jay Phan`;

  let md;
  try {
    const r = await fetch(post.path, { cache: 'no-cache' });
    if (!r.ok) throw new Error('status ' + r.status);
    md = await r.text();
  } catch (e) {
    target.innerHTML = `<p class="muted">Could not load article: ${escapeHtml(e.message)}</p>`;
    return;
  }

  // Protect math blocks from markdown's mangling, then restore after render.
  const mathStore = [];
  const PLACEHOLDER = (i) => `@@MATH${i}@@`;

  // $$ ... $$ (display)
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    mathStore.push({ display: true, expr });
    return PLACEHOLDER(mathStore.length - 1);
  });
  // $ ... $ (inline) — single $ not doubled
  md = md.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_, pre, expr) => {
    mathStore.push({ display: false, expr });
    return pre + PLACEHOLDER(mathStore.length - 1);
  });

  marked.setOptions({ gfm: true, breaks: false });
  let html = marked.parse(md);

  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => {
    const m = mathStore[Number(i)];
    if (!m) return '';
    const src = m.expr.trim();
    if (m.display) {
      return `<span class="math-block">${escapeHtml(src)}</span>`;
    }
    return `<span class="math-inline">${escapeHtml(src)}</span>`;
  });

  const meta = `<p class="post-meta">${escapeHtml(formatDate(post.date))}${post.section ? ' · ' + escapeHtml(post.section) : ''}</p>`;
  target.innerHTML = `<h1>${escapeHtml(post.title)}</h1>${meta}${html}`;

  whenKatexReady(() => {
    target.querySelectorAll('.math-block').forEach(el => {
      try {
        katex.render(el.textContent, el, { displayMode: true, throwOnError: false });
      } catch (e) { /* leave raw */ }
    });
    target.querySelectorAll('.math-inline').forEach(el => {
      try {
        katex.render(el.textContent, el, { displayMode: false, throwOnError: false });
      } catch (e) { /* leave raw */ }
    });
  });

  function whenKatexReady(cb) {
    if (window.katex) return cb();
    const t = setInterval(() => {
      if (window.katex) { clearInterval(t); cb(); }
    }, 30);
  }

  function findPost(manifest, slug) {
    for (const section of manifest.sections || []) {
      for (const p of section.posts || []) {
        if (p.slug === slug) return { ...p, section: section.title };
      }
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
})();
