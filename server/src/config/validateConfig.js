import { validateMongoDatabaseIsolation } from '../store/mongoDatabase.js';

function required (name, value, errors) {
    if (!String(value || '').trim()) errors.push(`${name} is required`);
}

export function validateConfig (config) {
    const errors = [];
    const databaseIsolation = validateMongoDatabaseIsolation({
        nodeEnv: config.nodeEnv,
        databaseName: config.mongodbDatabase,
        explicit: config.mongodbDatabaseExplicit
    });
    errors.push(...databaseIsolation.errors);

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

        if (!config.cloudflareAccessEnabled && !config.passwordLoginEnabled) {
            errors.push('At least one authentication method must be enabled in production');
        }

        if (config.legacyBearerEnabled) {
            errors.push('LEGACY_BEARER_ENABLED must not be enabled in production');
        }

        if (config.passwordLoginEnabled && config.seedDemoAdmin) {
            required('DEMO_ADMIN_EMAIL', config.demoAdminEmail, errors);
            required('DEMO_ADMIN_PASSWORD', config.demoAdminPassword, errors);
            if (config.demoAdminPassword === ['demo', '123456'].join('')) {
                errors.push('DEMO_ADMIN_PASSWORD must not use the public demo default in production');
            }
        }
    }

    if (config.cloudflareAccessEnabled) {
        required('CF_ACCESS_TEAM_DOMAIN', config.cloudflareAccessTeamDomain, errors);
        required('CF_ACCESS_AUD', config.cloudflareAccessAudience, errors);
        required('DEMO_TENANT_ID', config.demoTenantId, errors);
    }

    if (
        !Number.isInteger(config.sessionTtlSeconds) ||
        config.sessionTtlSeconds < 300 ||
        config.sessionTtlSeconds > 28800
    ) {
        errors.push('SESSION_TTL_SECONDS must be an integer between 300 and 28800');
    }

    if (!Number.isInteger(config.demoRunLimitPerHour) || config.demoRunLimitPerHour < 1) {
        errors.push('DEMO_RUN_LIMIT_PER_HOUR must be a positive integer');
    }

    if (!Number.isInteger(config.loginAttemptLimit) || config.loginAttemptLimit < 1) {
        errors.push('LOGIN_ATTEMPT_LIMIT must be a positive integer');
    }

    if (!Number.isInteger(config.loginAttemptWindowMs) || config.loginAttemptWindowMs < 1000) {
        errors.push('LOGIN_ATTEMPT_WINDOW_MS must be an integer of at least 1000');
    }

    if (config.demoAccessExpiresAt && Number.isNaN(Date.parse(config.demoAccessExpiresAt))) {
        errors.push('DEMO_ACCESS_EXPIRES_AT must be a valid ISO-8601 date-time');
    }

    if (!Number.isInteger(config.port) || config.port <= 0) {
        errors.push('PORT must be a positive integer');
    }

    if (errors.length) {
        throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
    }
}
