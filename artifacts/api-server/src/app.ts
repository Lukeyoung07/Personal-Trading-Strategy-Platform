import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const configuredOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const rateLimitRules = [
  { path: "/api/assistant/chat", max: 30 },
  { path: "/api/backtests", max: 30 },
  { path: "/api/market-data/candles/refresh", max: 30 },
  { path: "/api/strategy-monitoring/evaluate", max: 60 },
] as const;

function rateLimit(request: Request, response: Response, next: NextFunction) {
  const path = request.originalUrl.split("?")[0];
  const rule = rateLimitRules.find(candidate => path === candidate.path || path.startsWith(`${candidate.path}/`));
  if (!rule) {
    next();
    return;
  }
  const now = Date.now();
  const key = `${request.ip}:${rule.path}`;
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  if (bucket.count >= rule.max) {
    response.setHeader("Retry-After", "60");
    response.status(429).json({ error: "Too many requests. Please try again shortly." });
    return;
  }
  bucket.count += 1;
  next();
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));
app.use(rateLimit);

app.use("/api", router);

app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const typedError = error as { status?: number; statusCode?: number; type?: string; message?: string };
  const status = typedError.type === "entity.too.large" ? 413 : typedError.type === "entity.parse.failed" ? 400 : 500;
  logger.error({
    requestId: request.id,
    status,
    error: typedError.message || "Unknown request error",
  }, "Unhandled API request error");
  response.status(status).json({
    error: status === 413
      ? "Request is too large."
      : status === 400
        ? "Request body must be valid JSON."
        : "The server could not complete this request.",
  });
});

export default app;
