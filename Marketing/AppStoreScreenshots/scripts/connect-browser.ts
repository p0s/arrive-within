import { chromium, type Browser } from "playwright";
import { connectVerifiedBrowser } from "../../../scripts/lib/verified-browser.mjs";

export function connectScreenshotBrowser(): Promise<Browser> {
  return connectVerifiedBrowser(chromium);
}
