import { existsSync } from 'node:fs';
if (!process.env.EXPERTMESH_DESKTOP && existsSync('.env')) process.loadEnvFile('.env');
