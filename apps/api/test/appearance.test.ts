/** Görünüm tercihi (ADR-082): kullanıcı düzeyi, oturumla gelir, doğrulanır; kimliksiz erişim yok. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { EMAILS, login, startApp, type Client } from "./helpers.js";

let app: INestApplication; let dentist: Client;
beforeAll(async () => { app = await startApp(); dentist = await login(app, EMAILS.aDentist); });
afterAll(async () => app.close());

describe("GET/PUT /me/appearance", () => {
  it("varsayılan: cihaz ayarı, yeşil, ölçek 3; oturum yanıtında da var", async () => {
    await dentist.put("/me/appearance", { scheme: "system", accent: "yesil", scale: 3 }).expect(200);
    const r = (await dentist.get("/me/appearance").expect(200)).body;
    expect(r).toEqual({ scheme: "system", accent: "yesil", scale: 3 });
    const s = (await dentist.get("/session").expect(200)).body;
    expect(s.user.appearance).toEqual({ scheme: "system", accent: "yesil", scale: 3 });
  });
  it("geçerli tercih saklanır ve yeni oturumda gelir", async () => {
    await dentist.put("/me/appearance", { scheme: "dark", accent: "lacivert", scale: 4 }).expect(200);
    const again = await login(app, EMAILS.aDentist);
    expect(again.session.user.appearance).toEqual({ scheme: "dark", accent: "lacivert", scale: 4 });
    await dentist.put("/me/appearance", { scheme: "system", accent: "yesil", scale: 3 }).expect(200); // temizle
  });
  it("geçersiz değerler 422 (bilinmeyen palet, ölçek 9, fazladan alan)", async () => {
    await dentist.put("/me/appearance", { scheme: "light", accent: "neon", scale: 3 }).expect(422);
    await dentist.put("/me/appearance", { scheme: "light", accent: "yesil", scale: 9 }).expect(422);
    await dentist.put("/me/appearance", { scheme: "light", accent: "yesil", scale: 3, css: "body{}" }).expect(422);
  });
  it("kimliksiz 401", async () => {
    await request(app.getHttpServer()).get("/api/v1/me/appearance").expect(401);
  });
});
