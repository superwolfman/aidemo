import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(dirname, '../../../.env');

export function loadEnvironment () {
    const mode = process.env.NODE_ENV || 'development';

    if (mode === 'development') {
        dotenv.config({ path: rootEnv, override: false });
    }

    return mode;
}