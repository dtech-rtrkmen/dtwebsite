import sql from "mssql";

const config = {
  server: process.env.SQL_SERVER || "localhost",
  port: parseInt(process.env.SQL_PORT || "1433", 10),
  database: process.env.SQL_DATABASE || "WebSite",
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  options: {
    enableArithAbort: true,
    trustServerCertificate: process.env.SQL_TRUST_CERT === "true",
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let pool;
export async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(config);
  return pool;
}

export { sql };
