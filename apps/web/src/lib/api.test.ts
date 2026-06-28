import { describe, expect, it } from "vitest";
import { parseApiResponse } from "./api.js";

describe("parseApiResponse", () => {
  it("returns a friendly error for empty responses", async () => {
    const response = new Response("", { status: 502 });

    const body = await parseApiResponse(response);

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "HTTP_ERROR",
        details: { status: 502 }
      }
    });
    if (!body.success) {
      expect(body.error.message).toMatch(/HTTP 502/);
    }
  });

  it("returns a friendly error for non-json responses", async () => {
    const response = new Response("<html>bad gateway</html>", { status: 502 });

    const body = await parseApiResponse(response);

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "INVALID_JSON_RESPONSE",
        details: { status: 502 }
      }
    });
    if (!body.success) {
      expect(body.error.message).toBeTruthy();
    }
  });
});
