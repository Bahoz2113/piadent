import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { AppointmentContactChange, AppointmentCreate, AppointmentStatusChange, DayQuery } from "@viadent/contracts";
import { SchedulingService } from "./scheduling.service.js";
import { Ctx, Require } from "../auth/decorators.js";
import { Errors, parse } from "../infra/errors.js";
import type { RequestContext } from "../infra/context.js";

const apptId = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Randevu") });
const patientId = new ParseUUIDPipe({ exceptionFactory: () => Errors.notFound("Hasta") });

@Controller()
export class SchedulingController {
  constructor(@Inject(SchedulingService) private readonly scheduling: SchedulingService) {}

  @Get("resources")
  @Require("appointment.read")
  resources(@Ctx() ctx: RequestContext) {
    return this.scheduling.resources(ctx);
  }

  @Get("appointments")
  @Require("appointment.read")
  day(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.scheduling.day(ctx, parse(DayQuery, query).date);
  }

  @Get("patients/:id/appointments")
  @Require("appointment.read")
  async forPatient(@Ctx() ctx: RequestContext, @Param("id", patientId) id: string) {
    const items = await this.scheduling.forPatient(ctx, id);
    if (!items) throw Errors.notFound("Hasta");
    return { items };
  }

  @Post("appointments")
  @Require("appointment.write")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.scheduling.create(ctx, parse(AppointmentCreate, body));
  }

  @Post("appointments/:id/status")
  @HttpCode(200)
  @Require("appointment.write")
  status(@Ctx() ctx: RequestContext, @Param("id", apptId) id: string, @Body() body: unknown) {
    const input = parse(AppointmentStatusChange, body);
    return this.scheduling.changeStatus(ctx, id, input.version, input.status, input.cancelReason);
  }

  @Post("appointments/:id/contact")
  @HttpCode(200)
  @Require("appointment.write")
  contact(@Ctx() ctx: RequestContext, @Param("id", apptId) id: string, @Body() body: unknown) {
    const input = parse(AppointmentContactChange, body);
    return this.scheduling.changeContact(ctx, id, input.version, input.contactOutcome);
  }
}
