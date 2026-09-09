import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradingRouter from "./trading";
import marketDataRouter from "./market-data";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tradingRouter);
router.use(marketDataRouter);

export default router;
