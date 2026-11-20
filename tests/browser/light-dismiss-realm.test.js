/**
 * **`lightDismiss` belongs to the window its element is in** (Phase 0 item 5; CODE-PRINCIPLES §3, the rule `realm.test.js`
 * holds every component to). The hook took `CloseWatcher` from the module's `globalThis` once, at load, and listened on
 * the module's `document`: an element in an iframe or a popped-out window got the opener's document and the opener's
 * close watcher, so neither an outside press nor Escape there ever dismissed it.
 *
 * Real keys (`sendKeys`) drive Escape: `CloseWatcher` ignores untrusted events, so a synthetic Escape would measure the
 * fallback path on every engine. An iframe stands in for a popped-out window (same realm boundary); the popped-out
 * window itself runs where the launcher lets `window.open` return one, and says so where it does not.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys } from '@web/test-runner-commands';
import { lightDismiss } from '../../packages/hooks/light-dismiss/dist/development/vera-light-dismiss.js';

/** A same-origin realm: an `about:blank` iframe's document is ready as soon as it is connected. */
const frameRealm = () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  return { win: frame.contentWindow, doc: frame.contentDocument, close: () => frame.remove() };
};
/** A popped-out window, or null where the launcher blocks `window.open` without a gesture. */
const popupRealm = () => {
  const win = window.open('about:blank', '_blank', 'width=300,height=200');
  return win ? { win, doc: win.document, close: () => win.close() } : null;
};

/** Counts the listener types added to a document while `run` runs. */
const listenersAdded = (doc, run) => {
  const added = [];
  const original = doc.addEventListener;
  doc.addEventListener = function (type, ...rest) {
    added.push(type);
    return original.call(this, type, ...rest);
  };
  try {
    run();
  } finally {
    doc.addEventListener = original;
  }
  return added;
};

/** One wired element in `realm`: the element, a button outside it, the dismissals seen, and the controller. */
const wire = (realm) => {
  const element = realm.doc.createElement('div');
  const inside = realm.doc.createElement('button');
  const outside = realm.doc.createElement('button');
  element.append(inside);
  realm.doc.body.append(element, outside);
  const calls = [];
  const controller = lightDismiss(element, (event) => calls.push(event ? event.key : 'outside'));
  return { element, inside, outside, calls, controller };
};

const press = (target, win) => target.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, composed: true }));

for (const [name, open] of [['an iframe', frameRealm], ['a popped-out window', popupRealm]]) {
  describe(`lightDismiss in ${name}`, () => {
    let realm;
    let wired;
    beforeEach(function () {
      realm = open();
      if (!realm) this.skip(); // the launcher blocked window.open: the iframe rows stand for the realm here
      wired = wire(realm);
    });
    afterEach(() => {
      wired?.controller.deactivate();
      realm?.close();
      wired = undefined;
    });

    it("listens on that window's document, never the opener's", () => {
      const opener = listenersAdded(document, () => {
        const own = listenersAdded(realm.doc, () => wired.controller.activate());
        expect(own.includes('pointerdown')).to.equal(true);
      });
      expect(opener).to.deep.equal([]);
    });

    it('an outside press in that window dismisses; a press inside does not', () => {
      wired.controller.activate();
      press(wired.inside, realm.win);
      expect(wired.calls).to.deep.equal([]);
      press(wired.outside, realm.win);
      expect(wired.calls).to.deep.equal(['outside']);
    });

    it('a real Escape in that window dismisses, once, with an Escape event', async function () {
      /**
       * POSITIVE CONTROL first: the key must reach THIS window. `sendKeys` types into the focused page, and a popped-out
       * window is a page of its own, so its Escape can land in the opener instead, where the old hook listened, and
       * read as a pass (it did, on all three engines, 2026-11-21).
       */
      const seen = [];
      const note = (event) => seen.push(event.key);
      realm.doc.addEventListener('keydown', note, true);
      wired.controller.activate();
      realm.win.focus();
      wired.inside.focus();
      await sendKeys({ press: 'Escape' });
      realm.doc.removeEventListener('keydown', note, true);
      if (!seen.includes('Escape')) {
        if (realm.win !== window && realm.win.parent !== window) this.skip(); // the launcher cannot type into a popped-out window: the iframe row holds Escape
        expect.fail("the Escape never reached the iframe's document, so this row would measure nothing");
      }
      expect(wired.calls).to.deep.equal(['Escape']);
    });

    it("the close watcher is that window's own, where the window has one", function () {
      if (!realm.win.CloseWatcher) this.skip(); // this engine has no CloseWatcher: the keydown path is the row above
      let made = 0;
      const Native = realm.win.CloseWatcher;
      realm.win.CloseWatcher = class extends Native {
        constructor(...args) {
          super(...args);
          made++;
        }
      };
      try {
        wired.controller.activate();
      } finally {
        realm.win.CloseWatcher = Native;
      }
      expect(made).to.equal(1);
    });
  });
}
