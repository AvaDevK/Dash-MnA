// Snowflake client — mirrors V2 server/src/infra/snowflakeClient.ts
// Uses snowflake-sdk with JWT (private key) auth.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { env } = require("./config");

let snowflake;
try {
  snowflake = require("snowflake-sdk");
  snowflake.configure({ logLevel: "OFF" });
} catch {
  snowflake = null;
}

let cachedConnection = null;

function hasSnowflakeCredentials() {
  return !!(
    snowflake &&
    env.snowflakeAccount &&
    env.snowflakeUser &&
    (env.snowflakePrivateKey || env.snowflakePrivateKeyPath)
  );
}

function decryptPem(encryptedPem, passphrase) {
  const key = crypto.createPrivateKey({ key: encryptedPem, format: "pem", passphrase });
  return key.export({ type: "pkcs8", format: "pem" });
}

function resolvePrivateKey() {
  const passphrase = env.snowflakePrivateKeyPassphrase || undefined;

  if (env.snowflakePrivateKey) {
    const raw = env.snowflakePrivateKey.trimStart();
    const pem = raw.startsWith("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
    if (pem.includes("ENCRYPTED") && passphrase) {
      return { privateKey: decryptPem(pem, passphrase) };
    }
    return { privateKey: pem, privateKeyPass: passphrase };
  }

  if (env.snowflakePrivateKeyPath) {
    const raw = env.snowflakePrivateKeyPath.trim();
    const resolvedPath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Snowflake private key file not found: ${resolvedPath}`);
    }
    return { privateKeyPath: resolvedPath, privateKeyPass: passphrase };
  }

  throw new Error("No Snowflake private key configured. Set SNOWFLAKE_PRIVATE_KEY or SNOWFLAKE_PRIVATE_KEY_PATH.");
}

function getSnowflakeConnection() {
  return new Promise((resolve, reject) => {
    if (cachedConnection && cachedConnection.isUp()) {
      return resolve(cachedConnection);
    }
    const keyConfig = resolvePrivateKey();
    const conn = snowflake.createConnection({
      account: env.snowflakeAccount,
      username: env.snowflakeUser,
      authenticator: "SNOWFLAKE_JWT",
      ...keyConfig,
      warehouse: env.snowflakeWarehouse,
      database: env.snowflakeDatabase,
      schema: env.snowflakeSchema,
      role: env.snowflakeRole,
      clientSessionKeepAlive: true,
    });
    conn.connect((err) => {
      if (err) {
        cachedConnection = null;
        return reject(err);
      }
      cachedConnection = conn;
      resolve(conn);
    });
  });
}

function queryRows(sql, binds) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try {
      conn = await getSnowflakeConnection();
    } catch (err) {
      return reject(err);
    }
    conn.execute({
      sqlText: sql,
      binds: binds,
      complete: (err, _stmt, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      },
    });
  });
}

module.exports = { hasSnowflakeCredentials, queryRows };
