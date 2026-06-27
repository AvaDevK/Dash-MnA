-- ============================================================
-- Dashboard-MNA: SBR Hierarchy Cache — Dynamic Table Setup
--
-- Dedicated schema: ENGOPERATIONS_PROD_MART.DASH_MNA
-- (segregated from V2's ENGOPERATIONS_PROD_MART.PUBLIC)
--
-- Strategy mirrors V2 engineering-dashboards pattern:
--   - Dynamic table in ENGOPERATIONS_PROD_MART (app-specific schema)
--   - Direct JOIN hierarchy (same style as epic_spine in orangedash_gantt)
--   - 15-min TARGET_LAG (same as RI_TARGET_RELEASE_HISTORY_V in LeadersIntent)
--   - GRANT SELECT to the analyst service account role
--
-- Run with a role that has CREATE SCHEMA + CREATE DYNAMIC TABLE on
-- ENGOPERATIONS_PROD_MART. This is the SAME DB V2 uses but a SEPARATE schema.
-- ============================================================

USE WAREHOUSE ENGOPERATIONS_MAIN_RD_M_WH;
USE DATABASE ENGOPERATIONS_PROD_MART;

-- Create dedicated schema for Dashboard-MNA (one-time, idempotent)
CREATE SCHEMA IF NOT EXISTS ENGOPERATIONS_PROD_MART.DASH_MNA;

USE SCHEMA DASH_MNA;

CREATE OR REPLACE DYNAMIC TABLE ENGOPERATIONS_PROD_MART.DASH_MNA.SBR_HIERARCHY_CACHE
  TARGET_LAG = '15 minutes'
  WAREHOUSE  = ENGOPERATIONS_MAIN_RD_M_WH
AS
-- Direct JOIN hierarchy — mirrors epic_spine pattern from V2 OrangeDash Gantt VIEW.
-- Each level JOINs the previous to propagate SBR_KEY down the chain.
WITH
sbr_dim AS (
  SELECT KEY AS SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES
  WHERE FIELDS:"project":"key"::STRING = 'SBR'
    AND FIELDS:"issuetype":"name"::STRING = 'Strategic Priority'
),
l1 AS (
  -- Initiatives: direct children of SBR
  SELECT s.SBR_KEY, i.KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN sbr_dim s ON i.FIELDS:"parent":"key"::STRING = s.SBR_KEY
  WHERE i.FIELDS:"issuetype":"name"::STRING = 'Initiative'
),
l2 AS (
  -- Roadmap Items: children of Initiatives
  SELECT l1.SBR_KEY, i.KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN l1 ON i.FIELDS:"parent":"key"::STRING = l1.KEY
  WHERE i.FIELDS:"issuetype":"name"::STRING = 'Roadmap Item'
),
l3 AS (
  -- Epics: children of Roadmap Items
  SELECT l2.SBR_KEY, i.KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN l2 ON i.FIELDS:"parent":"key"::STRING = l2.KEY
  WHERE i.FIELDS:"issuetype":"name"::STRING = 'Epic'
),
l4a AS (
  -- Stories/Tasks under Epics
  SELECT l3.SBR_KEY, i.KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN l3 ON i.FIELDS:"parent":"key"::STRING = l3.KEY
  WHERE i.FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
),
l4b AS (
  -- Stories/Tasks directly under Roadmap Items (no Epic middleman)
  SELECT l2.SBR_KEY, i.KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN l2 ON i.FIELDS:"parent":"key"::STRING = l2.KEY
  WHERE i.FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
),
l4 AS (
  SELECT SBR_KEY, KEY FROM l4a
  UNION ALL
  SELECT SBR_KEY, KEY FROM l4b
),
l5 AS (
  -- Sub-tasks: children of Stories/Tasks
  SELECT l4.SBR_KEY, i.KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN l4 ON i.FIELDS:"parent":"key"::STRING = l4.KEY
  WHERE i.FIELDS:"issuetype":"name"::STRING = 'Sub-task'
),
all_keys AS (
  SELECT SBR_KEY, SBR_KEY AS KEY FROM sbr_dim   -- SBR issue itself
  UNION ALL SELECT SBR_KEY, KEY FROM l1
  UNION ALL SELECT SBR_KEY, KEY FROM l2
  UNION ALL SELECT SBR_KEY, KEY FROM l3
  UNION ALL SELECT SBR_KEY, KEY FROM l4
  UNION ALL SELECT SBR_KEY, KEY FROM l5
)
SELECT
  ak.SBR_KEY,
  i.KEY,
  i.SUMMARY,
  i.STATUS_NAME,
  i.FIELDS:"status":"statusCategory":"key"::STRING AS STATUS_CATEGORY_KEY,
  COALESCE(i.ISSUE_TYPE, i.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
  i.FIELDS:"parent":"key"::STRING AS PARENT_KEY,
  i.FIELDS:"assignee":"displayName"::STRING AS ASSIGNEE,
  i.FIELDS:"labels" AS LABELS,
  i.CREATED,
  i.UPDATED_DATE,
  i.RESOLUTION_DATE,
  i.FIELDS:"issuelinks"::STRING AS ISSUE_LINKS_RAW
FROM DS_PROD_INGEST.JIRA.ISSUES i
JOIN all_keys ak ON i.KEY = ak.KEY;

-- ============================================================
-- Grants
-- ============================================================
GRANT USAGE ON SCHEMA ENGOPERATIONS_PROD_MART.DASH_MNA
  TO ROLE "SG-APPEXT-SNOWFLAKE-ENGOPERATIONS-ANALYST-ROLE";

GRANT SELECT ON DYNAMIC TABLE ENGOPERATIONS_PROD_MART.DASH_MNA.SBR_HIERARCHY_CACHE
  TO ROLE "SG-APPEXT-SNOWFLAKE-ENGOPERATIONS-ANALYST-ROLE";

-- ============================================================
-- Validation (run 30s after creation)
-- ============================================================
-- SHOW DYNAMIC TABLES IN SCHEMA ENGOPERATIONS_PROD_MART.DASH_MNA;
-- SELECT COUNT(*) AS total_rows, COUNT(DISTINCT SBR_KEY) AS sbr_count
--   FROM ENGOPERATIONS_PROD_MART.DASH_MNA.SBR_HIERARCHY_CACHE;
-- SELECT SBR_KEY, ISSUE_TYPE, COUNT(*) AS cnt
--   FROM ENGOPERATIONS_PROD_MART.DASH_MNA.SBR_HIERARCHY_CACHE
--   WHERE SBR_KEY = 'SBR-356' GROUP BY 1, 2 ORDER BY 3 DESC;
