import type { AppRoute } from "../types.js";

export function parseRoute(pathname = window.location.pathname): AppRoute {
  if (pathname === "/settings") return { kind: "settings" };
  if (pathname === "/runs") return { kind: "history" };
  const reportMatch = pathname.match(/^\/reports\/([^/]+)\/?$/);
  if (reportMatch?.[1]) return { kind: "report", runId: decodeURIComponent(reportMatch[1]) };
  const runMatch = pathname.match(/^\/runs\/([^/]+)\/?$/);
  if (runMatch?.[1]) return { kind: "workbench", runId: decodeURIComponent(runMatch[1]) };
  if (pathname === "/") return { kind: "workbench" };
  return { kind: "not_found" };
}

export function pathForRoute(route: AppRoute) {
  if (route.kind === "settings") return "/settings";
  if (route.kind === "history") return "/runs";
  if (route.kind === "report") return `/reports/${encodeURIComponent(route.runId)}`;
  if (route.kind === "workbench") {
    return route.runId ? `/runs/${encodeURIComponent(route.runId)}` : "/";
  }
  // not_found 不应参与 pathForRoute，防御性返回 /
  return "/";
}
