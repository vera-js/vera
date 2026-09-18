/**
 * A realistic **TSX** consumer, type-checked against the shipped `.d.ts` through the exact tsconfig
 * the docs tell people to write — `"jsx": "preserve"` plus `"types": ["@verajs/jsx"]`.
 *
 * It exists because the sibling `consumer.ts` cannot reach any of this: the JSX namespace is
 * ambient, so it is only exercised by a file that actually contains JSX, compiled by a config that
 * actually loads the package's types. That gap shipped a real defect. `key` on a FUNCTION COMPONENT
 * was `TS2322 — Property 'key' does not exist on type '{ title: string }'`, while the transform
 * handled it in both emitters and it ran correctly; the types forbade a feature the compiler
 * implements. A dash-named tag never showed it, because `IntrinsicElements`' index signature
 * accepts anything, so every in-repo check passed.
 *
 * It never runs. Everything here exists to be compiled.
 */

/** A dash-named tag: bare props are properties, and anything is accepted. */
const element = <order-row item={{ id: 1 }} count={2} active />;

/** `key` on a dash-named tag — the path that always worked. */
const keyedElement = <order-row key="a" item={{ id: 1 }} />;

/** A function component, the shape a TSX app writes most. */
const Card = (props: { title: string; children?: unknown }) => <div>{props.title}</div>;

/** `key` on a COMPONENT — the regression this file exists for. */
const keyedComponent = <Card key={1} title="one" />;

/** Keys are compared by value, so any identity is legitimate — not just React's string | number. */
const stringKey = <Card key="two" title="two" />;
const objectKey = <Card key={{ id: 3 }} title="three" />;

/** Children pass through `ElementChildrenAttribute`. */
const withChildren = <Card title="four">a child</Card>;

/** A consumer types their own element by merging into IntrinsicElements — the reason it is an interface. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- JSX IS a namespace; tsc reads it by that name
  namespace JSX {
    interface IntrinsicElements {
      'my-own-card': { heading: string };
    }
  }
}
const declared = <my-own-card heading="typed" />;

export { element, keyedElement, keyedComponent, stringKey, objectKey, withChildren, declared };
