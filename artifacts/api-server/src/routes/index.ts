import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradingRouter from "./trading";
import marketDataRouter from "./market-data";
import strategyMonitoringRouter from "./strategy-monitoring";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tradingRouter);
router.use(marketDataRouter);
router.use(strategyMonitoringRouter);

export default router;
