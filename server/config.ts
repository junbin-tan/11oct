import path from 'node:path';

const DEV_COOKIE_SECRET = 'local-development-cookie-secret-not-for-production';

export interface Config {
  production: boolean;
  port: number;
  host: string;
  dataDir: string;
  cookieSecret: string;
  cookieSecure: boolean;
  clientDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';

  const cookieSecret = env.COOKIE_SECRET || (production ? '' : DEV_COOKIE_SECRET);
  if (cookieSecret.length < 32) {
    throw new Error('COOKIE_SECRET must be set to at least 32 characters in production.');
  }

  const dataDir = env.RAILWAY_VOLUME_MOUNT_PATH || env.DATA_DIR || path.resolve('.data');
  const port = Number(env.PORT ?? (production ? 3000 : 3001));

  return {
    production,
    port,
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    cookieSecret,
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    clientDir: production ? path.resolve('dist/client') : null,
  };
}
