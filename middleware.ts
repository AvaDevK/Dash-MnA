import { next } from "@vercel/edge";

export const config = {
  matcher: "/((?!api/health).*)",
};

const REALM = "Dashboard-MNA";

function unauthorized() {
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}

export default function middleware(request: Request) {
  const user = process.env.DASH_USER || "leadership";
  const pass = process.env.DASH_PASSWORD;

  if (!pass) {
    return new Response(
      "DASH_PASSWORD is not configured on the deployment. Set it in Vercel project settings → Environment Variables.",
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return unauthorized();

  let decoded = "";
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return unauthorized();
  }

  const idx = decoded.indexOf(":");
  if (idx < 0) return unauthorized();
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);

  if (u === user && p === pass) {
    return next();
  }
  return unauthorized();
}
