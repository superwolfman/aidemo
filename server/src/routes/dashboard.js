import express from 'express';

export function dashboardRouter(store) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const [documents, tasks] = await Promise.all([store.listDocuments(), store.listTasks()]);
    const statusCounts = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      store: store.kind,
      metrics: {
        documents: documents.length,
        chunks: documents.reduce((sum, doc) => sum + (doc.chunkCount || 0), 0),
        tasks: tasks.length,
        waitingApproval: statusCounts.waiting_approval || 0,
        successTasks: statusCounts.success || 0
      },
      recentTasks: tasks.slice(0, 5)
    });
  });

  return router;
}
