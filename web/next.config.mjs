import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  experimental: {
    serverComponentsExternalPackages: ['@electric-sql/pglite', 'pg'],
    outputFileTracingIncludes: {
      '/wht/[id]/pdf': ['./assets/**/*'],
      '/**/*': ['./migrations/**/*', './node_modules/@electric-sql/pglite/dist/**/*'],
    },
  },
  webpack: (config) => {
    config.resolve.alias['@'] = root;
    return config;
  },
};
