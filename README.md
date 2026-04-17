# Personal website

Simple static site. No build step.

## Run locally

Because the site loads `.md` files via `fetch()`, open it through a local server (not `file://`):

```sh
cd /Users/jayphan/src/personal-website
python3 -m http.server 8000
# then visit http://localhost:8000
```

Any static server works (`npx serve .`, `caddy file-server`, etc.).

## Structure

```
index.html          About page
blog.html           Blog index (groups posts by section)
article.html        Article viewer — reads ?slug=<slug> and loads the MD
css/style.css
js/blog-index.js
js/article.js       Parses markdown + renders $…$ / $$…$$ math via KaTeX
blog/
  manifest.json     Registry of sections and posts
  ml/               One folder per section (convention, not required)
    why-squared-error.md
assets/
  profile.jpg       Your LinkedIn photo (drop it in — see assets/README.md)
  profile-placeholder.svg
```

## Writing a new article

1. Create the markdown file anywhere under `blog/`, e.g.
   `blog/ml/backprop-from-scratch.md`.

2. Add an entry to `blog/manifest.json` under the right section:

   ```json
   {
     "slug": "backprop-from-scratch",
     "title": "Backprop from Scratch",
     "date": "2026-05-01",
     "path": "blog/ml/backprop-from-scratch.md"
   }
   ```

   - `slug` is the URL param (`article.html?slug=backprop-from-scratch`). Letters, digits, and dashes only.
   - `date` is ISO `YYYY-MM-DD`. Posts are sorted newest first.
   - `path` is relative to the site root.

3. To add a new section (e.g. "Software"), append another object to `sections`:

   ```json
   { "title": "Software", "posts": [ ... ] }
   ```

## Writing markdown

Standard CommonMark / GitHub-flavored markdown, plus:

- **Inline math**: `$E = mc^2$`
- **Display math**: `$$ \sum_{i=1}^n x_i $$`

Rendered with [KaTeX](https://katex.org/) (loaded from CDN).

For figure placeholders (drawings you haven't made yet), drop in:

```html
<figure class="placeholder">[Graph of X versus Y]</figure>
```

Real images: `![alt text](assets/my-image.png)`.
# personalwebsite
