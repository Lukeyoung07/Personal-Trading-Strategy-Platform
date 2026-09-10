import { Router, type IRouter } from "express";
import {
  GetEconomicEventProviderStatusResponse,
  ListEconomicEventsQueryParams,
  ListEconomicEventsResponse,
  UpdateEconomicEventBody,
  UpdateEconomicEventParams,
  UpdateEconomicEventResponse,
  UpsertEconomicEventBody,
  UpsertEconomicEventResponse,
} from "@workspace/api-zod";
import {
  getEconomicEventProviderStatus,
  listEconomicEvents,
  refreshEconomicEvents,
  updateEconomicEvent,
  upsertEconomicEvent,
} from "../services/economic-events";

const router: IRouter = Router();

router.get("/economic-events", async (req, res): Promise<void> => {
  const parsed = ListEconomicEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    await refreshEconomicEvents();
    res.json(ListEconomicEventsResponse.parse(await listEconomicEvents(parsed.data)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Economic calendar provider unavailable.";
    res.status(502).json({ error: message });
  }
});

router.post("/economic-events", async (req, res): Promise<void> => {
  const parsed = UpsertEconomicEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(UpsertEconomicEventResponse.parse(await upsertEconomicEvent(parsed.data)));
});

router.patch("/economic-events/:eventId", async (req, res): Promise<void> => {
  const params = UpdateEconomicEventParams.safeParse(req.params);
  const body = UpdateEconomicEventBody.safeParse(req.body);
  if (!params.success || !body.success) {
    const message = params.success ? (body.success ? "Invalid request" : body.error.message) : params.error.message;
    res.status(400).json({ error: message });
    return;
  }
  const updated = await updateEconomicEvent(params.data.eventId, body.data);
  if (!updated) {
    res.status(404).json({ error: "Economic event not found" });
    return;
  }
  res.json(UpdateEconomicEventResponse.parse(updated));
});

router.get("/economic-events/providers", async (_req, res): Promise<void> => {
  res.json(GetEconomicEventProviderStatusResponse.parse(getEconomicEventProviderStatus()));
});

export default router;