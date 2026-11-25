/**
 * Components that write the parts of the document every render shares (the `lang` and an attribute of `<html>`, an
 * attribute of `<body>`, the cookie) and one that reads them: in time, from work a timed-out render left running, and
 * from work a synchronous render left on a timer; and one that puts a `<body>` of its own in place, in time and late, and one that writes late to a `<body>` it put in place in time. The module sets a `lang` and a body flag at its top, which are the
 * process's, as any module's own state is. Built for `tests/ssr-shared-document.test.mjs`.
 */
import { init, html } from '@verajs/core';

document.documentElement.lang = 'en';
document.body.setAttribute('data-app', 'shell');

const seen = (globalThis.__sharedDocument ??= {});

const read = () => ({
  lang: document.documentElement.lang,
  flag: document.documentElement.getAttribute('data-flag'),
  body: document.body.getAttribute('data-app'),
  hidden: document.body.hasAttribute('hidden'),
  cookie: document.cookie,
  custom: document.body.getAttribute('data-custom'),
});

const write = (who) => {
  document.documentElement.lang = who;
  document.documentElement.setAttribute('data-flag', who);
  document.body.removeAttribute('data-app');
  document.body.toggleAttribute('hidden', true);
  document.cookie = `who=${who}`;
};

customElements.define('doc-writer-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>writer</p>`);
    write('alice');
    seen.writer = read();
  }
});

customElements.define('doc-reader-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>reader</p>`);
    seen.reader = read();
  }
});

customElements.define('doc-late-ssr', class extends HTMLElement {
  async connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>late</p>`);
    await new Promise((done) => setTimeout(done, 60));
    write('late');
    seen.lateRan = true;
  }
});

const ownBody = (mark) => {
  const custom = document.createElement('body');
  custom.setAttribute('data-custom', mark);
  document.body = custom;
};

customElements.define('doc-swap-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>swap</p>`);
    ownBody('swap');
    seen.swapped = document.body.getAttribute('data-custom');
  }
});

customElements.define('doc-late-swap-ssr', class extends HTMLElement {
  async connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>late swap</p>`);
    await new Promise((done) => setTimeout(done, 60));
    ownBody('late');
    seen.lateSwapRan = true;
  }
});

/** Puts a `<body>` of its own in place in time, then, after its render has timed out, writes to that body and to the document's. */
customElements.define('doc-swap-then-late-ssr', class extends HTMLElement {
  async connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>swap then late</p>`);
    ownBody('kept');
    const mine = document.body;
    await new Promise((done) => setTimeout(done, 60));
    mine.setAttribute('data-app', 'orphan');
    document.body.setAttribute('data-custom', 'late');
    seen.orphanWritten = mine.getAttribute('data-app');
  }
});

customElements.define('doc-timer-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<p>timer</p>`);
    setTimeout(() => {
      write('timer');
      seen.timerRan = true;
    }, 0);
  }
});
