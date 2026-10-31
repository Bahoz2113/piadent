import { OpsController } from "./ops/ops.controller.js";
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
import { SecurityController } from "./team/security.controller.js";
import { InvitationsController } from "./team/invitations.controller.js";
import { ResourcesController } from "./scheduling/resources.controller.js";
import { RelationsController } from "./patients/relations.controller.js";
import { AnamnesisController } from "./clinical/anamnesis.controller.js";
import { CatalogController } from "./treatment/catalog.controller.js";
import { PlansController } from "./treatment/plans.controller.js";
import { ChartController } from "./treatment/chart.controller.js";
import { AccountController } from "./finance/account.controller.js";
import { FinanceController } from "./finance/finance.controller.js";
import { DocumentsController } from "./documents/documents.controller.js";
import { FilesController } from "./documents/files.controller.js";
import { CareController } from "./documents/care.controller.js";
import { BridgeController } from "./bridge/bridge.controller.js";
import { SuppliersController } from "./operations/suppliers.controller.js";
import { LabController } from "./operations/lab.controller.js";
import { StockController } from "./operations/stock.controller.js";
import { ReportsController } from "./reports/reports.controller.js";
import { ImportController } from "./pilot/import.controller.js";
import { ExportController } from "./pilot/export.controller.js";
import { MfaController } from "./auth/mfa.controller.js";

@Module({})
export class AppModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [OpsController, AuthController, PatientsController, RelationsController, SchedulingController, ResourcesController, ClinicalController, AnamnesisController, TasksController, TeamController, InvitationsController, CatalogController, PlansController, ChartController, AccountController, FinanceController, DocumentsController, FilesController, CareController, BridgeController, SuppliersController, LabController, StockController, ReportsController, ImportController, ExportController, MfaController, SecurityController],
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
