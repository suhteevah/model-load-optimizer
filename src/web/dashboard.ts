/**
 * Dashboard HTTP handler - serves the HTML dashboard.
 */

import { getDashboardHtml } from "./dashboard-html.js";

type HttpRequest = {
  method?: string;
  url?: string;
};

type HttpResponse = {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

export function createDashboardHandler() {
  const html = getDashboardHtml();

  return (_req: HttpRequest, res: HttpResponse): void => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  };
}
