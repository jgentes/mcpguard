import { defineConfig, defineDocs } from 'fumadocs-mdx/config';

export const { docs, meta } = defineDocs({
  docs: {
    dir: 'content/docs',
  },
  meta: {
    dir: 'content/docs',
  },
});

export default defineConfig();
