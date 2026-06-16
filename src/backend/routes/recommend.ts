// Placeholder — recommendation logic lands in Task 4.
import { Router } from 'express';

export const recommendRouter = Router();

recommendRouter.post('/recommend', (_req, res) => {
  res.json({ looks: [], note: 'recommend endpoint pending Task 4' });
});
