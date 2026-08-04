function required (name, value, errors) {
    if (!String(value || '').trim()) errors.push(`${name} is required`);
}

export function validateConfig (config) {
    const errors = [];

    if (config.nodeEnv === 'production') {
        required('JWT_SECRET', config.jwtSecret, errors);
        required('MONGODB_URI or MONGODB_ATLAS_URI', config.mongodbUri, errors);

        if (config.jwtSecret === 'local-demo-secret') {
            errors.push('JWT_SECRET must not use the demo default in production');
        }

        if (config.llmProvider !== 'mock' && !config.llmApiKey) {
            errors.push('Configured live LLM provider requires an API key');
        }

        if (
            config.nodeEnv === 'production' &&
            config.allowFileStoreFallback
        ) {
            errors.push(
                'ALLOW_FILE_STORE_FALLBACK must not be enabled in production'
            );
        }
    }

    if (!Number.isInteger(config.port) || config.port <= 0) {
        errors.push('PORT must be a positive integer');
    }

    if (errors.length) {
        throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
    }
}