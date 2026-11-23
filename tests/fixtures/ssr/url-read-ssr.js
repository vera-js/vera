/** Reads a relative `a.href` back during its render, so a test can see which URL the server's DOM resolved it against. */
class UrlRead extends HTMLElement {
  connectedCallback() {
    const link = document.createElement('a');
    link.href = 'x';
    this.textContent = link.href;
  }
}
customElements.define('url-read-ssr', UrlRead);
