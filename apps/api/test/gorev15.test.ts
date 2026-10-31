/** Görev 15 — demo işletim ucu (ADR-078): kapalıyken 404, yanlış belirteç 401, dolu veritabanında seed atlanır ve migration listesi boş. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { startApp } from "./helpers.js";
import { OWNER_URL } from "./env.js";

let app: INestApplication;
beforeAll(async () => { app = await startApp(); });
afterAll(async () => { await app.close(); delete process.env.VIADENT_DEMO_BOOTSTRAP; delete process.env.OPS_TOKEN; delete process.env.MIGRATION_DATABASE_URL; });

describe("POST /ops/bootstrap", () => {
  it("bayrak yokken 404; yanlış belirteç 401; doğru belirteçle dolu DB'de seed atlanır, uygulanacak migration yok", async () => {
    const s = app.getHttpServer();
    expect((await request(s).post("/api/v1/ops/bootstrap").set("x-viadent-request", "1")).status).toBe(404);
    process.env.VIADENT_DEMO_BOOTSTRAP = "1"; process.env.OPS_TOKEN = "test-only-ops-token-1234567890"; process.env.MIGRATION_DATABASE_URL = OWNER_URL;
    expect((await request(s).post("/api/v1/ops/bootstrap").set("x-viadent-request", "1").set("x-ops-token", "yanlis")).status).toBe(401);
    const r = await request(s).post("/api/v1/ops/bootstrap").set("x-viadent-request", "1").set("x-ops-token", "test-only-ops-token-1234567890").expect(200);
    expect(r.body).toMatchObject({ applied: [], seeded: false });
  });
});
