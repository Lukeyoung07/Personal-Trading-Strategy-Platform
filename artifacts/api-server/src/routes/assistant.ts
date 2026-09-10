import { Router, type IRouter } from "express";
import { ChatAssistantBody, ChatAssistantResponse } from "@workspace/api-zod";
import { answerAssistant } from "../services/assistant";

const router: IRouter = Router();

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = ChatAssistantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a message and assistant context." });
    return;
  }
  const response = await answerAssistant(parsed.data);
  res.json(ChatAssistantResponse.parse(response));
});

export default router;