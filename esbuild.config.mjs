import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  // The Claude Agent SDK ships platform-specific native binaries via
  // optional dependencies — those won't survive bundling, so we leave the
  // SDK and its peer/transitive deps in node_modules and require() them
  // at runtime. The .vsix includes node_modules of `dependencies`.
  external: [
    'vscode',
    '@anthropic-ai/claude-agent-sdk',
    '@anthropic-ai/sdk',
    '@modelcontextprotocol/sdk',
    'zod',
  ],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: !watch,
});

if (watch) {
  await ctx.watch();
  console.log('esbuild: watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
