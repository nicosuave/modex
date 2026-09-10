import { main as verify } from '../combined/verify-mod.mjs';
export const main = (args = process.argv.slice(2)) => verify(args, { mods: ['custom-cli'] });
if (import.meta.main)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
