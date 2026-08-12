export function makeShippingHTMLClassic(html: string): string {
  return html.replaceAll(' type="module"', " defer").replaceAll(" crossorigin", "");
}
