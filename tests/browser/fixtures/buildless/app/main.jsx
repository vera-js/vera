import { html } from '@verajs/core';
import { renderer, renderInto } from '@verajs/renderer';
import { slots } from '@verajs/renderer/slots';
import { wire } from '@verajs/core';
import { Frame } from './frame.jsx';
import { label } from './lib/util.js';
wire([renderer, slots]);
const rows = [1, 2, 3].map((n) => <li key={n}>{label} {n}</li>);
renderInto(<main><ul>{rows}</ul><Frame><path d="M0 0h24" /></Frame></main>, document.body);
/** A light host's child distributed into its slot — `@verajs/renderer/slots` is not in the map. */
const host = document.createElement('div');
host.innerHTML = '<b slot="title">T</b>';
document.body.appendChild(host);
renderInto(<section><slot name="title" /></section>, host);
const late = await import('./late.jsx');
parent.postMessage({ kind: 'app', svg: document.querySelector('path')?.namespaceURI, items: document.querySelectorAll('li').length, meta: import.meta.url, late: late.value, slotted: host.querySelector('section > b')?.textContent ?? null }, '*');
