(async function () {
  const container = document.getElementById('sections');
  const empty = document.getElementById('empty');

  try {
    const res = await fetch('blog/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest fetch failed: ' + res.status);
    const data = await res.json();

    const sections = data.sections || [];
    const hasAny = sections.some(s => (s.posts || []).length > 0);
    if (!hasAny) {
      empty.hidden = false;
      return;
    }

    for (const section of sections) {
      const posts = (section.posts || []).slice().sort((a, b) => {
        return (b.date || '').localeCompare(a.date || '');
      });
      if (posts.length === 0) continue;

      const sec = document.createElement('section');
      sec.className = 'section';
      sec.innerHTML = `<h2>${escapeHtml(section.title)}</h2>`;

      const ul = document.createElement('ul');
      ul.className = 'post-list';

      for (const post of posts) {
        const li = document.createElement('li');
        const href = `article.html?slug=${encodeURIComponent(post.slug)}`;
        li.innerHTML = `
          <a class="title" href="${href}">${escapeHtml(post.title)}</a>
          <span class="date">${escapeHtml(formatDate(post.date))}</span>
        `;
        ul.appendChild(li);
      }

      sec.appendChild(ul);
      container.appendChild(sec);
    }
  } catch (err) {
    container.innerHTML = `<p class="muted">Could not load posts: ${escapeHtml(err.message)}</p>`;
    console.error(err);
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
