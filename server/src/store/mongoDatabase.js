const DATABASE_BY_ENVIRONMENT = Object.freeze({
    development: 'aidemo_dev',
    test: 'aidemo_test',
    production: 'aidemo_prod'
});

const RESERVED_DATABASES = new Set(['admin', 'config', 'local']);

export function runtimeDatabaseEnvironment (nodeEnv = 'development') {
    if (nodeEnv === 'production') return 'production';
    if (nodeEnv === 'test') return 'test';
    return 'development';
}

export function defaultMongoDatabaseName (nodeEnv = 'development') {
    return DATABASE_BY_ENVIRONMENT[runtimeDatabaseEnvironment(nodeEnv)];
}

export function validateMongoDatabaseIsolation ({ nodeEnv, databaseName, explicit = false }) {
    const environment = runtimeDatabaseEnvironment(nodeEnv);
    const name = String(databaseName || '').trim();
    const errors = [];

    if (!name) errors.push('MONGODB_DB_NAME is required');
    if (name && !/^[A-Za-z0-9_-]+$/.test(name)) {
        errors.push('MONGODB_DB_NAME may only contain letters, numbers, underscores and hyphens');
    }
    if (RESERVED_DATABASES.has(name.toLowerCase())) {
        errors.push(`MONGODB_DB_NAME must not use the reserved MongoDB database "${name}"`);
    }
    if (environment === 'production' && !explicit) {
        errors.push('MONGODB_DB_NAME must be explicitly configured in production');
    }
    const environmentSuffix = {
        development: 'dev',
        test: 'test',
        production: 'prod'
    }[environment];
    const suffix = `_${environmentSuffix}`;
    if (name && !name.endsWith(suffix)) {
        errors.push(`MONGODB_DB_NAME for ${environment} must end with "${suffix}"`);
    }
    return { environment, errors };
}

export async function ensureMongoDatabaseEnvironment (db, environment) {
    const collection = db.collection('environment_metadata');
    const marker = await collection.findOne({ _id: 'runtime-environment' });
    if (marker && marker.environment !== environment) {
        throw new Error(
            `MongoDB environment mismatch: runtime=${environment}, ` +
            `database=${db.databaseName}, marker=${marker.environment}`
        );
    }
    if (!marker) {
        await collection.insertOne({
            _id: 'runtime-environment',
            environment,
            databaseName: db.databaseName,
            createdAt: new Date()
        });
    }
}
