import app from "./app";
import { logger } from "./lib/logger";
import { biQuoteAdapter, ensureBiQuoteCatalog } from "./services/biquote";
import { dukascopyAdapter, ensureDukascopyCatalog } from "./services/dukascopy";
import { marketDataService } from "./services/market-data";
import { resumeBacktestJobs } from "./routes/backtesting";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await ensureBiQuoteCatalog();
await ensureDukascopyCatalog();
marketDataService.register(biQuoteAdapter);
marketDataService.register(dukascopyAdapter);
await resumeBacktestJobs();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
