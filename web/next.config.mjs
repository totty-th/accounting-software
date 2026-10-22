import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  experimental: { serverComponentsExternalPackages: ['@electric-sql/pglite', 'pg'] },
  webpack: (config) => {
    config.resolve.alias['@'] = root;
    return config;
  },
};
