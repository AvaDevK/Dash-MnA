/**
 * Creates the Snowflake Dynamic Table that pre-materializes the SBR issue hierarchy.
 * Run once: node scripts/create-dynamic-table.cjs
 */
require("dotenv").config({ path: ".env.local" });

const { queryRows } = require("../api/_mna/snowflakeClient");

const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE || "ENGOPERATIONS_MAIN_RD_M_WH";

const DDL = `
CREATE OR REPLACE DYNAMIC TABLE DS_PROD_INGEST.JIRA.SBR_HIERARCHY_CACHE
  TARGET_LAG = '15 minutes'
  WAREHOUSE = ${WAREHOUSE}
AS
WITH
  sbr AS (
    SELECT KEY FROM DS_PROD_INGEST.JIRA.ISSUES
    WHERE ISSUE_TYPE ILIKE '%Strategic Business Requirement%' OR KEY LIKE 'SBR-%'
  ),
  l1 AS (
    SELECT i.KEY, i.FIELDS:"parent":"key"::STRING AS SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES i
    WHERE i.FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM sbr)
  ),
  l2 AS (SELECT i.KEY, l1.SBR_KEY FROM DS_PROD_INGEST.JIRA.ISSUES i JOIN l1 ON i.FIELDS:"parent":"key"::STRING = l1.KEY),
  l3 AS (SELECT i.KEY, l2.SBR_KEY FROM DS_PROD_INGEST.JIRA.ISSUES i JOIN l2 ON i.FIELDS:"parent":"key"::STRING = l2.KEY),
  l4 AS (SELECT i.KEY, l3.SBR_KEY FROM DS_PROD_INGEST.JIRA.ISSUES i JOIN l3 ON i.FIELDS:"parent":"key"::STRING = l3.KEY),
  l5 AS (SELECT i.KEY, l4.SBR_KEY FROM DS_PROD_INGEST.JIRA.ISSUES i JOIN l4 ON i.FIELDS:"parent":"key"::STRING = l4.KEY),
  all_keys AS (
    SELECT KEY, SBR_KEY FROM l1 UNION SELECT KEY, SBR_KEY FROM l2
    UNION SELECT KEY, SBR_KEY FROM l3 UNION SELECT KEY, SBR_KEY FROM l4
    UNION SELECT KEY, SBR_KEY FROM l5 UNION SELECT KEY, KEY AS SBR_KEY FROM sbr
  )
SELECT
  ak.SBR_KEY, i.KEY, i.SUMMARY, i.STATUS_NAME,
  i.FIELDS:"status":"statusCategory":"key"::STRING AS STATUS_CATEGORY_KEY,
  COALESCE(i.ISSUE_TYPE, i.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
  i.FIELDS:"parent":"key"::STRING AS PARENT_KEY,
  i.FIELDS:"assignee":"displayName"::STRING AS ASSIGNEE,
  i.FIELDS:"labels" AS LABELS,
  i.CREATED, i.UPDATED_DATE, i.RESOLUTION_DATE,
  i.FIELDS:"issuelinks"::STRING AS ISSUE_LINKS_RAW
FROM DS_PROD_INGEST.JIRA.ISSUES i
JOIN all_keys ak ON i.KEY = ak.KEY
`;

async function run() {
  console.log("Creating Dynamic Table DS_PROD_INGEST.JIRA.SBR_HIERARCHY_CACHE ...");
  try {
    await queryRows(DDL);
    console.log("✅ Dynamic Table created.");
  } catch (err) {
    console.error("❌ CREATE DYNAMIC TABLE failed:", err.message || err);
    process.exit(1);
  }
  try {
    const rows = await queryRows(
      "SELECT COUNT(*) AS C, COUNT(DISTINCT SBR_KEY) AS SBRS FROM DS_PROD_INGEST.JIRA.SBR_HIERARCHY_CACHE"
    );
    console.log(`✅ Table ready: ${rows[0]?.C ?? "?"} rows, ${rows[0]?.SBRS ?? "?"} SBRs`);
  } catch (err) {
    console.warn("⚠️  Verify query failed (table may still be initializing):", err.message);
  }
  console.log("Done. Table will refresh automatically every 15 minutes.");
  process.exit(0);
}

run().catch((err) => { console.error("❌", err.message || err); process.exit(1); });
