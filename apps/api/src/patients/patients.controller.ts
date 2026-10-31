import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { PatientCreate, PatientSearchQuery, PatientUpdate } from "@viadent/contracts";
import { PatientsService } from "./patients.service.js";
import { Ctx, Require } from "../auth/decorators.js";
import { Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Hasta") });

@Controller("patients")
export class PatientsController {
  constructor(@Inject(PatientsService) private readonly patients: PatientsService) {}

  @Get()
  @Require("patient.read")
  async search(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    const q = parse(PatientSearchQuery, query);
    return { items: await this.patients.search(ctx, q.q, q.limit) };
  }

  @Post("duplicates")
  @HttpCode(200)
  @Require("patient.write")
  async duplicates(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return { candidates: await this.patients.checkDuplicates(ctx, parse(PatientCreate, body)) };
  }

  @Post()
  @Require("patient.write")
  async create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.patients.create(ctx, parse(PatientCreate, body));
  }

  @Get(":id")
  @Require("patient.read")
  async get(@Ctx() ctx: RequestContext, @Param("id", uuidPipe) id: string) {
    const p = await this.patients.get(ctx, id);
    if (!p) throw Errors.notFound("Hasta");
    return p;
  }

  @Patch(":id")
  @Require("patient.write")
  async update(@Ctx() ctx: RequestContext, @Param("id", uuidPipe) id: string, @Body() body: unknown) {
    return this.patients.update(ctx, id, parse(PatientUpdate, body));
  }

  @Get(":id/history")
  @Require("patient.read")
  async history(@Ctx() ctx: RequestContext, @Param("id", uuidPipe) id: string) {
    const h = await this.patients.history(ctx, id);
    if (!h) throw Errors.notFound("Hasta");
    return { items: h };
  }
}
