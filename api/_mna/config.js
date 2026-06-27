// MNA API config — reads env vars matching V2's infra/config.ts

const env = {
  jiraEmail: (process.env.JIRA_EMAIL || "").trim(),
  jiraApiToken: (process.env.JIRA_API_TOKEN || "").trim(),
  jiraBaseUrl: (process.env.JIRA_BASE_URL || "https://avalara.atlassian.net").trim(),

  snowflakeUser: (process.env.SNOWFLAKE_USER || "").trim(),
  snowflakeAccount: (process.env.SNOWFLAKE_ACCOUNT || "AVALARA-AVALARA_AWS_US_WEST_2").trim(),
  snowflakePrivateKey: (process.env.SNOWFLAKE_PRIVATE_KEY || "").trim(),
  snowflakePrivateKeyPath: (process.env.SNOWFLAKE_PRIVATE_KEY_PATH || "").trim(),
  snowflakePrivateKeyPassphrase: (process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE || "").trim(),
  snowflakeWarehouse: (process.env.SNOWFLAKE_WAREHOUSE || "ENGOPERATIONS_MAIN_RD_M_WH").trim(),
  snowflakeDatabase: (process.env.SNOWFLAKE_DATABASE || "DS_PROD_INGEST").trim(),
  snowflakeSchema: (process.env.SNOWFLAKE_SCHEMA || "JIRA").trim(),
  snowflakeRole: (process.env.SNOWFLAKE_ROLE || "SG-APPEXT-SNOWFLAKE-ENGOPERATIONS-ANALYST-ROLE").trim(),

  mnaDataSource: (process.env.MNA_DATA_SOURCE || "auto").trim().toLowerCase(),
  mnaNameCustomFieldId: (process.env.MNA_NAME_CUSTOM_FIELD_ID || "").trim(),
  mnaRiCustomFieldId: (process.env.MNA_RI_CUSTOM_FIELD_ID || "").trim(),
  mnaCacheTtlMs: Number(process.env.MNA_CACHE_TTL_MS) > 0 ? Number(process.env.MNA_CACHE_TTL_MS) : 300_000,
};

module.exports = { env };
