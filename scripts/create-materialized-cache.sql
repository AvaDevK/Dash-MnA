-- ============================================================================
-- DASHBOARD-MNA: SBR HIERARCHY MATERIALIZED CACHE SETUP
-- ============================================================================
-- Alternative to Dynamic Table (requires special privilege).
-- Uses a regular TABLE + Stored Procedure + Scheduled Task instead.
--
-- Run this script ONCE in Snowflake to set up.
-- The task will then auto-refresh the table every 15 minutes.
--
-- WHAT THIS CREATES:
--   1. Schema    — ENGOPERATIONS_DEV_MART.DASH_MNA (if not exists)
--   2. Table     — ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE
--   3. Procedure — REFRESH_SBR_HIERARCHY_CACHE  (rebuilds the table)
--   4. Task      — TASK_REFRESH_SBR_HIERARCHY_CACHE  (runs every 15 min)
--
-- AFTER RUNNING:
--   Set _dynamicTableAvailable = true in api/_mna/snowflakeFetch.js
--   This enables the fast-path (<1s reads from pre-materialized table).
--
-- PREREQUISITES:
--   CREATE TABLE, CREATE PROCEDURE, CREATE TASK on ENGOPERATIONS_DEV_MART.DASH_MNA
--   SELECT on DS_PROD_INGEST.JIRA.ISSUES
--   USAGE on ENGOPERATIONS_MAIN_RD_M_WH
-- ============================================================================

USE DATABASE ENGOPERATIONS_DEV_MART;

CREATE SCHEMA IF NOT EXISTS ENGOPERATIONS_DEV_MART.DASH_MNA;

USE SCHEMA DASH_MNA;

-- ============================================================================
-- STEP 1: Initial table build (runs the full JOIN once, stores results)
-- Re-running this is safe — CREATE OR REPLACE atomically swaps the table.
-- ============================================================================
CREATE OR REPLACE TABLE ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE AS
WITH
sbrs AS (
  SELECT
    KEY, SUMMARY, STATUS_NAME,
    FIELDS:"status":"statusCategory":"key"::STRING            AS STATUS_CATEGORY_KEY,
    COALESCE(ISSUE_TYPE, FIELDS:"issuetype":"name"::STRING)   AS ISSUE_TYPE,
    FIELDS:"parent":"key"::STRING                             AS PARENT_KEY,
    FIELDS:"assignee":"displayName"::STRING                   AS ASSIGNEE,
    FIELDS:"labels"                                           AS LABELS,
    CREATED, UPDATED_DATE, RESOLUTION_DATE,
    FIELDS:"issuelinks"::STRING                               AS ISSUE_LINKS_RAW,
    KEY                                                       AS SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES
  WHERE FIELDS:"issuetype":"name"::STRING = 'Strategic Priority'
    AND STATUS_NAME != 'Done'
),
initiatives AS (
  SELECT
    i.KEY, i.SUMMARY, i.STATUS_NAME,
    i.FIELDS:"status":"statusCategory":"key"::STRING          AS STATUS_CATEGORY_KEY,
    COALESCE(i.ISSUE_TYPE, i.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
    i.FIELDS:"parent":"key"::STRING                           AS PARENT_KEY,
    i.FIELDS:"assignee":"displayName"::STRING                 AS ASSIGNEE,
    i.FIELDS:"labels"                                         AS LABELS,
    i.CREATED, i.UPDATED_DATE, i.RESOLUTION_DATE,
    i.FIELDS:"issuelinks"::STRING                             AS ISSUE_LINKS_RAW,
    s.KEY                                                     AS SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES i
  JOIN sbrs s ON i.FIELDS:"parent":"key"::STRING = s.KEY
  WHERE COALESCE(i.ISSUE_TYPE, i.FIELDS:"issuetype":"name"::STRING) = 'Initiative'
),
roadmap_items AS (
  SELECT
    ri.KEY, ri.SUMMARY, ri.STATUS_NAME,
    ri.FIELDS:"status":"statusCategory":"key"::STRING         AS STATUS_CATEGORY_KEY,
    COALESCE(ri.ISSUE_TYPE, ri.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
    ri.FIELDS:"parent":"key"::STRING                          AS PARENT_KEY,
    ri.FIELDS:"assignee":"displayName"::STRING                AS ASSIGNEE,
    ri.FIELDS:"labels"                                        AS LABELS,
    ri.CREATED, ri.UPDATED_DATE, ri.RESOLUTION_DATE,
    ri.FIELDS:"issuelinks"::STRING                            AS ISSUE_LINKS_RAW,
    i.SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES ri
  JOIN initiatives i ON ri.FIELDS:"parent":"key"::STRING = i.KEY
  WHERE COALESCE(ri.ISSUE_TYPE, ri.FIELDS:"issuetype":"name"::STRING) = 'Roadmap Item'
),
epics AS (
  SELECT
    e.KEY, e.SUMMARY, e.STATUS_NAME,
    e.FIELDS:"status":"statusCategory":"key"::STRING          AS STATUS_CATEGORY_KEY,
    COALESCE(e.ISSUE_TYPE, e.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
    e.FIELDS:"parent":"key"::STRING                           AS PARENT_KEY,
    e.FIELDS:"assignee":"displayName"::STRING                 AS ASSIGNEE,
    e.FIELDS:"labels"                                         AS LABELS,
    e.CREATED, e.UPDATED_DATE, e.RESOLUTION_DATE,
    e.FIELDS:"issuelinks"::STRING                             AS ISSUE_LINKS_RAW,
    ri.SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES e
  JOIN roadmap_items ri ON e.FIELDS:"parent":"key"::STRING = ri.KEY
  WHERE e.FIELDS:"issuetype":"name"::STRING = 'Epic'
),
stories AS (
  SELECT
    s.KEY, s.SUMMARY, s.STATUS_NAME,
    s.FIELDS:"status":"statusCategory":"key"::STRING          AS STATUS_CATEGORY_KEY,
    COALESCE(s.ISSUE_TYPE, s.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
    s.FIELDS:"parent":"key"::STRING                           AS PARENT_KEY,
    s.FIELDS:"assignee":"displayName"::STRING                 AS ASSIGNEE,
    s.FIELDS:"labels"                                         AS LABELS,
    s.CREATED, s.UPDATED_DATE, s.RESOLUTION_DATE,
    s.FIELDS:"issuelinks"::STRING                             AS ISSUE_LINKS_RAW,
    e.SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES s
  JOIN epics e ON s.FIELDS:"parent":"key"::STRING = e.KEY
  WHERE s.FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
),
subtasks AS (
  SELECT
    st.KEY, st.SUMMARY, st.STATUS_NAME,
    st.FIELDS:"status":"statusCategory":"key"::STRING         AS STATUS_CATEGORY_KEY,
    COALESCE(st.ISSUE_TYPE, st.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
    st.FIELDS:"parent":"key"::STRING                          AS PARENT_KEY,
    st.FIELDS:"assignee":"displayName"::STRING                AS ASSIGNEE,
    st.FIELDS:"labels"                                        AS LABELS,
    st.CREATED, st.UPDATED_DATE, st.RESOLUTION_DATE,
    st.FIELDS:"issuelinks"::STRING                            AS ISSUE_LINKS_RAW,
    s.SBR_KEY
  FROM DS_PROD_INGEST.JIRA.ISSUES st
  JOIN stories s ON st.FIELDS:"parent":"key"::STRING = s.KEY
  WHERE st.FIELDS:"issuetype":"name"::STRING = 'Sub-task'
)
SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
       PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
       RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM sbrs
UNION ALL
SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
       PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
       RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM initiatives
UNION ALL
SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
       PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
       RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM roadmap_items
UNION ALL
SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
       PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
       RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM epics
UNION ALL
SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
       PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
       RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM stories
UNION ALL
SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
       PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
       RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM subtasks;

-- ============================================================================
-- STEP 2: Stored procedure — wraps the CTAS so the Task can call it
-- ============================================================================
CREATE OR REPLACE PROCEDURE ENGOPERATIONS_DEV_MART.DASH_MNA.REFRESH_SBR_HIERARCHY_CACHE()
RETURNS STRING
LANGUAGE SQL
AS
$$
BEGIN
  CREATE OR REPLACE TABLE ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE AS
  WITH
  sbrs AS (
    SELECT
      KEY, SUMMARY, STATUS_NAME,
      FIELDS:"status":"statusCategory":"key"::STRING            AS STATUS_CATEGORY_KEY,
      COALESCE(ISSUE_TYPE, FIELDS:"issuetype":"name"::STRING)   AS ISSUE_TYPE,
      FIELDS:"parent":"key"::STRING                             AS PARENT_KEY,
      FIELDS:"assignee":"displayName"::STRING                   AS ASSIGNEE,
      FIELDS:"labels"                                           AS LABELS,
      CREATED, UPDATED_DATE, RESOLUTION_DATE,
      FIELDS:"issuelinks"::STRING                               AS ISSUE_LINKS_RAW,
      KEY                                                       AS SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES
    WHERE FIELDS:"issuetype":"name"::STRING = 'Strategic Priority'
      AND STATUS_NAME != 'Done'
  ),
  initiatives AS (
    SELECT
      i.KEY, i.SUMMARY, i.STATUS_NAME,
      i.FIELDS:"status":"statusCategory":"key"::STRING          AS STATUS_CATEGORY_KEY,
      COALESCE(i.ISSUE_TYPE, i.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
      i.FIELDS:"parent":"key"::STRING                           AS PARENT_KEY,
      i.FIELDS:"assignee":"displayName"::STRING                 AS ASSIGNEE,
      i.FIELDS:"labels"                                         AS LABELS,
      i.CREATED, i.UPDATED_DATE, i.RESOLUTION_DATE,
      i.FIELDS:"issuelinks"::STRING                             AS ISSUE_LINKS_RAW,
      s.KEY                                                     AS SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES i
    JOIN sbrs s ON i.FIELDS:"parent":"key"::STRING = s.KEY
    WHERE COALESCE(i.ISSUE_TYPE, i.FIELDS:"issuetype":"name"::STRING) = 'Initiative'
  ),
  roadmap_items AS (
    SELECT
      ri.KEY, ri.SUMMARY, ri.STATUS_NAME,
      ri.FIELDS:"status":"statusCategory":"key"::STRING         AS STATUS_CATEGORY_KEY,
      COALESCE(ri.ISSUE_TYPE, ri.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
      ri.FIELDS:"parent":"key"::STRING                          AS PARENT_KEY,
      ri.FIELDS:"assignee":"displayName"::STRING                AS ASSIGNEE,
      ri.FIELDS:"labels"                                        AS LABELS,
      ri.CREATED, ri.UPDATED_DATE, ri.RESOLUTION_DATE,
      ri.FIELDS:"issuelinks"::STRING                            AS ISSUE_LINKS_RAW,
      i.SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES ri
    JOIN initiatives i ON ri.FIELDS:"parent":"key"::STRING = i.KEY
    WHERE COALESCE(ri.ISSUE_TYPE, ri.FIELDS:"issuetype":"name"::STRING) = 'Roadmap Item'
  ),
  epics AS (
    SELECT
      e.KEY, e.SUMMARY, e.STATUS_NAME,
      e.FIELDS:"status":"statusCategory":"key"::STRING          AS STATUS_CATEGORY_KEY,
      COALESCE(e.ISSUE_TYPE, e.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
      e.FIELDS:"parent":"key"::STRING                           AS PARENT_KEY,
      e.FIELDS:"assignee":"displayName"::STRING                 AS ASSIGNEE,
      e.FIELDS:"labels"                                         AS LABELS,
      e.CREATED, e.UPDATED_DATE, e.RESOLUTION_DATE,
      e.FIELDS:"issuelinks"::STRING                             AS ISSUE_LINKS_RAW,
      ri.SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES e
    JOIN roadmap_items ri ON e.FIELDS:"parent":"key"::STRING = ri.KEY
    WHERE e.FIELDS:"issuetype":"name"::STRING = 'Epic'
  ),
  stories AS (
    SELECT
      s.KEY, s.SUMMARY, s.STATUS_NAME,
      s.FIELDS:"status":"statusCategory":"key"::STRING          AS STATUS_CATEGORY_KEY,
      COALESCE(s.ISSUE_TYPE, s.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
      s.FIELDS:"parent":"key"::STRING                           AS PARENT_KEY,
      s.FIELDS:"assignee":"displayName"::STRING                 AS ASSIGNEE,
      s.FIELDS:"labels"                                         AS LABELS,
      s.CREATED, s.UPDATED_DATE, s.RESOLUTION_DATE,
      s.FIELDS:"issuelinks"::STRING                             AS ISSUE_LINKS_RAW,
      e.SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES s
    JOIN epics e ON s.FIELDS:"parent":"key"::STRING = e.KEY
    WHERE s.FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
  ),
  subtasks AS (
    SELECT
      st.KEY, st.SUMMARY, st.STATUS_NAME,
      st.FIELDS:"status":"statusCategory":"key"::STRING         AS STATUS_CATEGORY_KEY,
      COALESCE(st.ISSUE_TYPE, st.FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
      st.FIELDS:"parent":"key"::STRING                          AS PARENT_KEY,
      st.FIELDS:"assignee":"displayName"::STRING                AS ASSIGNEE,
      st.FIELDS:"labels"                                        AS LABELS,
      st.CREATED, st.UPDATED_DATE, st.RESOLUTION_DATE,
      st.FIELDS:"issuelinks"::STRING                            AS ISSUE_LINKS_RAW,
      s.SBR_KEY
    FROM DS_PROD_INGEST.JIRA.ISSUES st
    JOIN stories s ON st.FIELDS:"parent":"key"::STRING = s.KEY
    WHERE st.FIELDS:"issuetype":"name"::STRING = 'Sub-task'
  )
  SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
         PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
         RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM sbrs
  UNION ALL
  SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
         PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
         RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM initiatives
  UNION ALL
  SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
         PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
         RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM roadmap_items
  UNION ALL
  SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
         PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
         RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM epics
  UNION ALL
  SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
         PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
         RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM stories
  UNION ALL
  SELECT KEY, SUMMARY, STATUS_NAME, STATUS_CATEGORY_KEY, ISSUE_TYPE,
         PARENT_KEY, ASSIGNEE, LABELS, CREATED, UPDATED_DATE,
         RESOLUTION_DATE, ISSUE_LINKS_RAW, SBR_KEY FROM subtasks;

  RETURN 'Refreshed at ' || CURRENT_TIMESTAMP()::STRING;
END;
$$;

-- ============================================================================
-- STEP 3: Scheduled task — runs every 15 minutes
-- NOTE: Tasks start SUSPENDED — run the ALTER below to activate
-- ============================================================================
CREATE OR REPLACE TASK ENGOPERATIONS_DEV_MART.DASH_MNA.TASK_REFRESH_SBR_HIERARCHY_CACHE
  WAREHOUSE = ENGOPERATIONS_MAIN_RD_M_WH
  SCHEDULE  = '15 MINUTE'
AS
  CALL ENGOPERATIONS_DEV_MART.DASH_MNA.REFRESH_SBR_HIERARCHY_CACHE();

-- Activate the task (tasks are created SUSPENDED by default)
ALTER TASK ENGOPERATIONS_DEV_MART.DASH_MNA.TASK_REFRESH_SBR_HIERARCHY_CACHE RESUME;

-- ============================================================================
-- STEP 4: Grants — allow the app role to read the table
-- ============================================================================
GRANT USAGE  ON SCHEMA ENGOPERATIONS_DEV_MART.DASH_MNA
  TO ROLE "SG-APPEXT-SNOWFLAKE-ENGOPERATIONS-ANALYST-ROLE";
GRANT SELECT ON TABLE  ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE
  TO ROLE "SG-APPEXT-SNOWFLAKE-ENGOPERATIONS-ANALYST-ROLE";

-- ============================================================================
-- VERIFICATION (run after setup)
-- ============================================================================

-- Check row counts per SBR:
-- SELECT SBR_KEY, ISSUE_TYPE, COUNT(*) AS ROWS
-- FROM ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE
-- GROUP BY SBR_KEY, ISSUE_TYPE ORDER BY SBR_KEY, ISSUE_TYPE;

-- Manual refresh (skip waiting for the task):
-- CALL ENGOPERATIONS_DEV_MART.DASH_MNA.REFRESH_SBR_HIERARCHY_CACHE();

-- Check task run history:
-- SELECT NAME, STATE, SCHEDULED_TIME, COMPLETED_TIME, ERROR_MESSAGE
-- FROM TABLE(INFORMATION_SCHEMA.TASK_HISTORY())
-- WHERE NAME = 'TASK_REFRESH_SBR_HIERARCHY_CACHE'
-- ORDER BY SCHEDULED_TIME DESC;

-- Pause task if needed:
-- ALTER TASK ENGOPERATIONS_DEV_MART.DASH_MNA.TASK_REFRESH_SBR_HIERARCHY_CACHE SUSPEND;
