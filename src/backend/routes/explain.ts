// Placeholder — natural language explanations land in Task 4.
import { Router } from 'express';

export const explainRouter = Router();

explainRouter.post('/explain', (_req, res) => {
  res.json({ explanation: 'explain endpoint pending Task 4' });
});
