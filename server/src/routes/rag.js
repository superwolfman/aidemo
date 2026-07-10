import express from 'express';
import { aiService } from '../services/aiService.js';
import { closeSse, initSse, sendEvent } from '../utils/sse.js';

export function ragRouter(store) {
  const router = express.Router();

  router.get('/documents', async (req, res) => {
    res.json({ documents: await store.listDocuments() });
  });

  router.post('/documents', async (req, res) => {
    const { title, content, tags } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ message: 'title and content are required' });
    }

    const document = await store.createDocument({
      title,
      content,
      tags: Array.isArray(tags) ? tags : String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean)
    });
    res.status(201).json({ document });
  });

  router.post('/ask/stream', async (req, res) => {
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ message: 'question is required' });

    initSse(res);
    const contexts = await store.searchChunks(question, 5);
    sendEvent(res, 'retrieval', { contexts });
    const answer = aiService.ragAnswer(question, contexts);
    await aiService.streamMarkdown(res, answer, sendEvent);
    closeSse(res);
  });

  return router;
}
