import { config } from '../config.js';
import { FileStore } from './fileStore.js';
import { MongoStore } from './mongoStore.js';

export async function createStore () {
    const mongo = new MongoStore(config.mongodbUri);

    try {
        await mongo.init();

        console.log(
            `[store] MongoDB connected: ${config.redactedMongoUri}`
        );

        return mongo;
    } catch (error) {
        const reason =
            error instanceof Error
                ? error.message
                : String(error);

        if (!config.allowFileStoreFallback) {
            console.error(
                '[store] MongoDB initialization failed. ' +
                'FileStore fallback is disabled.'
            );

            throw new Error(
                'MongoDB initialization failed and ' +
                'FileStore fallback is disabled.',
                { cause: error }
            );
        }

        console.warn(
            '[store] MongoDB unavailable. ' +
            'Using FileStore because ' +
            'ALLOW_FILE_STORE_FALLBACK=true. ' +
            `Reason: ${reason}`
        );

        const file = new FileStore();

        file.connectionError = reason;
        file.requestedStore = 'mongo';

        await file.init();

        return file;
    }
}