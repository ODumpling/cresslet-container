// The node worker's global `process` (modules/process.ts createProcess), as far as the modules reach it through
// globalThis. Not in tsconfig.test.json: tests run in real Node, where @types/node's `process` applies.
interface WorkerGlobalProcess {
  env: Record<string, string | undefined>
  cwd(): string
  stdout: { write(chunk: string): unknown; isTTY?: boolean }
  stderr: { write(chunk: string): unknown; isTTY?: boolean }
  emitWarning?(warning: string): void
}
declare var process: WorkerGlobalProcess
