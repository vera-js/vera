import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseUrl } from '../src/modules/url.ts';
import { createMotion } from '../src/index.ts';
import { parseAttributeName } from '../src/modules/schema.ts';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('hostile DOM', () => {
  it('an element removed mid-flight does not throw on the next frame', async () => {
    document.body.innerHTML = '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    document.getElementById('a').remove();
    await settle();
    expect(() => a.refresh()).not.toThrow();
    a.destroy();
  });

  it('an element moved to a different parent keeps animating', async () => {
    document.body.innerHTML =
      '<div id="from"><div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div></div><div id="to"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    document.getElementById('to').appendChild(document.getElementById('a'));
    await settle();
    expect(a.elements.filter((e) => e.node.id === 'a')).toHaveLength(1);
    a.destroy();
  });

  it('an attribute rewritten to nonsense drops the animation, leaving content readable', async () => {
    document.body.innerHTML = '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const node = document.getElementById('a');
    node.setAttribute('data-vera-motion-opacity', 'garbage');
    await settle();
    expect(node.style.filter === '' || node.style.filter === 'opacity(1)').toBe(true);
    a.destroy();
  });

  it('a detached root passed to observe() does not throw', () => {
    document.body.innerHTML = '';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const orphan = document.createElement('div');
    orphan.innerHTML = '<div data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    expect(() => a.observe(orphan)).not.toThrow();
    a.destroy();
  });

  it('init() on a document with no animated elements is a no-op, not an error', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    const a = createMotion({ respectReducedMotion: false });
    expect(() => a.init()).not.toThrow();
    expect(a.elements).toHaveLength(0);
    expect(() => a.refresh()).not.toThrow();
    a.destroy();
  });

  it('an element whose attribute is emptied stops animating without throwing', async () => {
    document.body.innerHTML = '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    document.getElementById('a').setAttribute('data-vera-motion-opacity', '');
    await settle();
    expect(() => a.refresh()).not.toThrow();
    a.destroy();
  });

  it('disable() then destroy() leaves no inline animation styles behind', () => {
    document.body.innerHTML =
      '<div id="a" data-vera-motion data-vera-motion-opacity="0% 0, 100% 1" data-vera-motion-translate-y="0% 10px, 100% 0px"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    a.disable();
    a.destroy();
    const node = document.getElementById('a');
    expect(node.style.transform).toBe('');
    expect(node.style.filter).toBe('');
    expect(node.style.transition).toBe('');
  });
});

describe('prototype pollution via attribute names and option keys', () => {
  it('nothing reaches Object.prototype', () => {
    const before = Object.keys(Object.prototype).length;

    document.body.innerHTML = `
      <div data-vera-motion="__proto__"
           data-vera-motion-__proto__="0% 0, 100% 1"
           data-vera-motion-constructor="1"
           data-vera-motion-opacity-__proto__="0% 0, 100% 1"
           data-vera-motion-opacity-constructor="0% 0, 100% 1"
           data-vera-motion-opacity="0% 0, 100% 1"></div>`;

    const m = createMotion({
      respectReducedMotion: false,
      breakpoints: { __proto__: [0, 500], constructor: [501, 900], toString: [901, 2000] },
    });
    m.init();

    expect(Object.keys(Object.prototype).length).toBe(before);
    expect({}.polluted).toBeUndefined();
    expect(({}).constructor).toBe(Object);
    m.destroy();
  });

  it('a hostile breakpoint alias cannot fabricate a range', () => {
    const m = createMotion({ respectReducedMotion: false, breakpoints: {} });
    m.init();
    /** toString/valueOf exist on every object; a Map lookup must not find them. */
    for (const name of ['toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const got = parseAttributeName(`data-vera-motion-opacity-${name}`, new Map());
      expect(got).toBeNull();
    }
    m.destroy();
  });
});

const BASE = 'https://site.test/page';
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

describe('parseUrl scheme smuggling', () => {
  it('rejects every scheme-smuggling shape', () => {
    const hostile = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java' + TAB + 'script:alert(1)',
      'java' + LF + 'script:alert(1)',
      'java' + CR + 'script:alert(1)',
      ' javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://site.test/abc',
      /**
       * The one shape only the post-URL() protocol check stops. It evades the
       * scheme regex because URL() strips the tab, and unlike an obfuscated
       * javascript: it normalises to an origin equal to the page's own — so
       * the same-origin check passes it. Mutation testing found this gap:
       * removing that check left the suite green.
       */
      'bl' + TAB + 'ob:https://site.test/abc',
      'bl' + LF + 'ob:https://site.test/abc',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.test/frames/',
      'https://evil.test/frames/',
      'https://site.test@evil.test/',
      'HTTPS://EVIL.TEST/f/',
    ];
    const leaked = [];
    for (const h of hostile) {
      const got = parseUrl(h, BASE);
      if (got !== null) leaked.push(JSON.stringify(h) + ' -> ' + got);
    }
    expect(leaked).toEqual([]);
  });

  it('still accepts what it should', () => {
    for (const ok of ['/frames/', './frames/', 'frames/', 'https://site.test/frames/']) {
      expect(parseUrl(ok, BASE), ok).not.toBeNull();
    }
    expect(parseUrl('https://cdn.test/f/', BASE, ['https://cdn.test'])).not.toBeNull();
  });
});
