import { runCli } from './cli.ts'

// exitCode instead of exit(): on Windows, stdout to a pipe is asynchronous and exit() could cut it off.
process.exitCode = await runCli(process.argv.slice(2))
