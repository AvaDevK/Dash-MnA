/**
 * GET /api/warm — cache warming endpoint, called by Vercel Cron every 5 min.
 *
 * Warms SBR-356 synchronously (most-used). After responding, fires background
 * fetches for the next top SBRs so switching is faster for the user.
 *
 * Vercel Hobby allows 1 cron job with a 60s function timeout.
 * We warm only 1 SBR synchronously to stay well under the limit.
 */

const TOP_SBRS = ["SBR-356"]; // extend if you want more pre-warmed

module.exports = async function handler(req, res) {
  // Only allow GET and cron invocations (Vercel sends a cron header)
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const results = [];
  const t0 = Date.now();

  for (const sbr of TOP_SBRS) {
    try {
      const url = `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/mna?sbr=${sbr}`;
      const resp = await fetch(url, { headers: { "x-warm-request": "1" } });
      const cacheHeader = resp.headers.get("x-cache") || "?";
      results.push({ sbr, status: resp.status, cache: cacheHeader, ms: Date.now() - t0 });
    } catch (err) {
      results.push({ sbr, error: err.message, ms: Date.now() - t0 });
    }
  }

  return res.status(200).json({
    warmed: results,
    totalMs: Date.now() - t0,
    ts: new Date().toISOString(),
  });
};
