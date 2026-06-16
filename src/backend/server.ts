import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: '妆语 MakeupWhisper' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[妆语] backend listening on http://localhost:${PORT}`);
});
