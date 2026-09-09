import { Router, type IRouter } from "express";
import {
  EvaluateActiveStrategiesBody,
  EvaluateActiveStrategiesResponse,
  ListStrategyMonitorsResponse,
} from "@workspace/api-zod";
import { strategyMonitoringEngine } from "../services/strategy-monitoring";

const router: IRouter = Router();

router.get("/strategy-monitoring", async (_req, res): Promise<void> => {
  const snapshots = await strategyMonitoringEngine.listActiveMonitors();
  res.json(ListStrategyMonitorsResponse.parse(snapshots));
});

router.post("/strategy-monitoring/evaluate", async (req, res): Promise<void> => {
  const parsed = EvaluateActiveStrategiesBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const snapshots = await strategyMonitoringEngine.evaluateActiveStrategies(parsed.data);
  res.json(EvaluateActiveStrategiesResponse.parse(snapshots));
});

export default router;