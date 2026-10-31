import pg from "pg";
import { migrate } from "@viadent/db";
import { seed } from "../../../packages/db/src/seed.js";
import { ADMIN_URL, OWNER_URL, TEST_DB, TEST_PASSWORD } from "./env.js";

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB} owner viadent_owner`);
  await admin.end();
  await migrate(OWNER_URL, () => undefined);
  await seed(OWNER_URL, { password: TEST_PASSWORD, quiet: true });
}
