import { config } from '../config.js';
import { FileStore } from './fileStore.js';
import { MongoStore } from './mongoStore.js';

export async function createStore() {
  const mongo = new MongoStore(config.mongodbUri);
  try {
    await mongo.init();
    console.log(`[store] MongoDB connected: ${config.mongodbUri}`);
    return mongo;
  } catch (error) {
    console.warn(`[store] MongoDB unavailable, using local file demo store. Reason: ${error.message}`);
    const file = new FileStore();
    await file.init();
    return file;
  }
}
