import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { CONFIG, type AppConfig } from "./config.js";
import { Db } from "./infra/db.service.js";
import { ApiExceptionFilter } from "./infra/errors.js";
import { AuthService } from "./auth/auth.service.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthController } from "./auth/auth.controller.js";
import { PatientsController } from "./patients/patients.controller.js";
import { PatientsService } from "./patients/patients.service.js";
import { SchedulingController } from "./scheduling/scheduling.controller.js";
import { SchedulingService } from "./scheduling/scheduling.service.js";
import { ClinicalController } from "./clinical/clinical.controller.js";
import { TasksController } from "./tasks/tasks.controller.js";
import { TeamController } from "./team/team.controller.js";
import { InvitationsController } from "./team/invitations.controller.js";
import { ResourcesController } from "./scheduling/resources.controller.js";
import { RelationsController } from "./patients/relations.controller.js";
import { AnamnesisController } from "./clinical/anamnesis.controller.js";

@Module({})
export class AppModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, PatientsController, RelationsController, SchedulingController, ResourcesController, ClinicalController, AnamnesisController, TasksController, TeamController, InvitationsController],
      providers: [
        { provide: CONFIG, useValue: config },
        Db,
        AuthService,
        PatientsService,
        SchedulingService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
