/**
 * GET /api/warm — warehouse keep-alive, called by Vercel Cron every 5 min.
 *
 * Directly queries Snowflake (tiny COUNT) to wake the warehouse before it
 * auto-suspends. Vercel Hobby maxDuration is 60s; a cold warehouse startup
 * takes 30-60s so we cannot do the full hierarchy fetch here. Instead we just
 * wake the warehouse so the next real user request hits a warm warehouse and
 * completes in <5s.
 */

const { queryRows, hasSnowflakeCredentials } = require("./_mna/snowflakeClient");
const CACHE_TABLE = "ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE";

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const t0 = Date.now();

  if (!hasSnowflakeCredentials()) {
    return res.status(200).json({ status: "skip", reason: "no snowflake credentials", ts: new Date().toISOString() });
  }

  try {
    // Lightweight ping — just enough to wake the warehouse. Fast once warm, but
    // safe to run on cold start because the query itself is trivial.
    const rows = await queryRows(
      `SELECT COUNT(*) AS C FROM ${CACHE_TABLE} WHERE SBR_KEY = 'SBR-356'`
    );
    const count = Number(rows[0]?.C ?? 0);
    return res.status(200).json({
      status: "warmed",
      sbr356Rows: count,
      warehouseMs: Date.now() - t0,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(200).json({
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
      ms: Date.now() - t0,
      ts: new Date().toISOString(),
    });
  }
};
