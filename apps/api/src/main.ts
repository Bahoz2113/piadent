import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.port, "127.0.0.1");
new Logger("viadent").log(`VİADENT API http://127.0.0.1:${config.port}/api/v1`);
