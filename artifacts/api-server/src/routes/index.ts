import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradingRouter from "./trading";
import marketDataRouter from "./market-data";
import strategyMonitoringRouter from "./strategy-monitoring";
import economicEventsRouter from "./economic-events";
import backtestingRouter from "./backtesting";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tradingRouter);
router.use(marketDataRouter);
router.use(strategyMonitoringRouter);
router.use(economicEventsRouter);
router.use(backtestingRouter);

export default router;
