import { init, createStore, render, wire } from '@verajs/core';
import { render as renderer } from '@verajs/renderer';
import { keyed } from '@verajs/renderer/keyed';
wire({ on: 'render', fn: renderer, priority: 50 });

const CARDS = [{ g: 'A' }, { g: 'B' }, { g: 'C' }];
const SPREADS = [{ id: 'one', positions: ['P1'] }, { id: 'ten', positions: 'abcdefghij'.split('') }];

const state = createStore({ spreadId: 'one', drawn: [], revealed: 0, focus: null, shuffling: false });
const spread = () => SPREADS.find((s) => s.id === state.spreadId);

const draw = () => {
  const n = spread().positions.length;
  state.shuffling = true;
  state.drawn = Array.from({ length: n }, (_, i) => ({ i: i % CARDS.length, reversed: i % 3 === 0 }));
  state.revealed = 0;
  state.focus = null;
  setTimeout(() => { state.shuffling = false; }, 5);
};

const Card = ({ entry, position, index, faceUp }) => (
  <div className="card-slot" style={`--slot:${index}`}>
    <div className="card-slot__label">{position}</div>
    <button className={faceUp ? 'card is-up' : 'card is-down'} onClick={() => { state.revealed += 1; }}>
      <span className="card__back"></span>
      <span className="card__face">
        <span className="card__glyph">{CARDS[entry.i].g}</span>
        {entry.reversed ? <span className="card__rev">reversed</span> : ''}
      </span>
    </button>
  </div>
);

const Detail = ({ entry }) => <div className="detail">{CARDS[entry.i].g}</div>;

const Reading = () => {
  const s = spread();
  const drawn = state.drawn;
  const done = state.revealed >= drawn.length;
  return (
    <section className="reading">
      <h2 className="reading__title">t</h2>
      <p className="reading__blurb">b</p>
      <div className="controls">
        <button className="btn btn--primary" onClick={draw}>Draw the spread</button>
        <button className="btn" onClick={() => { state.revealed = drawn.length; }}>Turn every card</button>
      </div>

      {drawn.length === 0
        ? <p className="empty">waiting</p>
        : <div className={state.shuffling ? 'layout is-dealing' : 'layout'} data-spread={s.id}>
            {drawn.map((entry, index) =>
              keyed(`${entry.i}-${index}`,
                <Card entry={entry} position={s.positions[index]} index={index} faceUp={index < state.revealed} />))}
          </div>}

      {drawn.length && state.revealed === 0
        ? <p className="hint">click</p>
        : ''}

      {state.focus !== null && state.focus < state.revealed
        ? <Detail entry={drawn[state.focus]} />
        : ''}

      {state.revealed > 0
        ? <div className="interpretation">
            <ol className="lines">
              {drawn.slice(0, state.revealed).map((entry, index) =>
                keyed(`line-${entry.i}-${index}`, <li className="line">{CARDS[entry.i].g}</li>))}
            </ol>
            {done
              ? <div className="synthesis">together</div>
              : <p className="hint">turn the rest</p>}
          </div>
        : ''}
    </section>
  );
};

const App = () => (
  <div className="shell">
    <nav className="spreads">
      {SPREADS.map((s) => keyed(s.id,
        <button className="spread-choice" onClick={() => { state.spreadId = s.id; state.drawn = []; state.revealed = 0; state.focus = null; }}>
          {s.id === 'ten' ? 'Celtic' : 'One'}
        </button>))}
    </nav>
    <Reading />
  </div>
);

class TarotApp extends HTMLElement {
  connectedCallback() { init(this); render(() => <App />); }
}
customElements.define('tarot-app', TarotApp);
