/**
 * The whole site: one component reading the generated manifests and the markdown beside them.
 *
 * Two content paths on display, and they are different on purpose:
 *
 *   - the LISTING comes from `_manifests/posts.json` — one static fetch, already sorted metadata,
 *     no markdown parsed at all;
 *   - an ARTICLE fetches its own `.md` and parses it here, in the browser — the buildless path,
 *     where `.innerHTML=${…}` is the renderer's documented escape hatch for markup you trust.
 *     This site's markup is its own repository, which is the definition of trusted here.
 */
import { init, createStore, render, html, wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { createReader, parseContent, serializeHtml } from '@verajs/cms/content';

wire([renderer]);

const reader = createReader({ url: './_manifests/' });

customElements.define(
  'cms-site',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ posts: [], terms: [], open: null, article: '' });

      reader.entries('posts', { sort: 'date:desc' }).then((posts) => {
        state.posts = posts;
      });
      /** Terms are entries too — `terms()` joins their files with usage counts from the index. */
      reader.terms('tags').then((terms) => {
        state.terms = terms.filter((term) => term.count > 0);
      });

      const open = async (post) => {
        state.open = post;
        const source = await fetch(`./content/posts/${post.slug}.md`).then((response) => response.text());
        state.article = serializeHtml(parseContent(source).root);
      };

      const close = () => {
        state.open = null;
        state.article = '';
      };

      /** One stable shape, toggled with `?hidden` — values update in place, no subtree teardown. */
      render(
        () => html`
          <header>
            <h1>A flat-file site</h1>
            <p ?hidden=${state.open !== null}>
              ${state.posts.length} posts, listed from one fetch of the generated index.
            </p>
            <p ?hidden=${state.open !== null}>
              ${state.terms.map((term) => html`<span>${term.data.title} (${term.count}) </span>`)}
            </p>
          </header>

          <ul ?hidden=${state.open !== null}>
            ${state.posts.map(
              (post) => html`
                <li>
                  <a href="#${post.slug}" @click=${() => open(post)}>${post.data.title}</a>
                  <small> — ${post.data.date}${post.data.tags ? ` · ${post.data.tags.join(', ')}` : ''}</small>
                  <p>${post.excerpt}</p>
                </li>
              `
            )}
          </ul>

          <article ?hidden=${state.open === null}>
            <p><a href="#" @click=${close}>← all posts</a></p>
            <div .innerHTML=${state.article}></div>
          </article>
        `
      );
    }
  }
);
