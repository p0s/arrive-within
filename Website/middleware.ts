import {
  OPT_IN_PATH,
  OPT_OUT_PATH,
  analyticsConfig,
  preferenceResponse,
  queueIngest,
} from "./src/analytics.mjs";

type RequestContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

export default function middleware(request: Request, context: RequestContext) {
  const config = analyticsConfig();
  const pathname = new URL(request.url).pathname;
  if (pathname === OPT_OUT_PATH) return preferenceResponse(request, "out", config);
  if (pathname === OPT_IN_PATH) return preferenceResponse(request, "in", config);
  queueIngest(request, context, config);
}
