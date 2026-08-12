import html from "../index.html?raw";
import { describe, expect, it } from "vitest";
import { makeShippingHTMLClassic } from "../src/shipping-html";

describe("shipping renderer isolation", () => {
  it("ships a restrictive content security policy with networking disabled", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'self' file:");
    expect(html).toContain("style-src 'self' file:");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("form-action 'none'");
  });

  it("contains no remote runtime source", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("//cdn.");
  });

  it("loads the single-file IIFE without module or cross-origin file requests", () => {
    const shippingHTML = makeShippingHTMLClassic(
      '<script type="module" crossorigin src="./assets/index.js"></script>',
    );
    expect(shippingHTML).toBe('<script defer src="./assets/index.js"></script>');
  });
});
