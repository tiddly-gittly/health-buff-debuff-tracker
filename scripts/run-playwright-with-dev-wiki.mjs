import { spawn, spawnSync } from 'node:child_process';

const forwardedArgs = process.argv.slice(2);

function spawnCommand(command, options = {}) {
  return spawn(command, {
    shell: true,
    ...options,
  });
}

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function runPlaywright(baseURL) {
  return new Promise((resolve, reject) => {
    const testProcess = spawnCommand(`pnpm exec playwright test ${forwardedArgs.join(' ')}`.trim(), {
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_BASE_URL: baseURL,
      },
    });

    testProcess.on('error', reject);
    testProcess.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  if (process.env.PLAYWRIGHT_BASE_URL) {
    const exitCode = await runPlaywright(process.env.PLAYWRIGHT_BASE_URL);
    process.exit(exitCode);
  }

  const serverProcess = spawnCommand('pnpm dev:wiki', {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    killProcessTree(serverProcess);
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  const startup = new Promise((resolve, reject) => {
    const onChunk = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      const match = text.match(/Serving on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        resolve(match[1]);
      }
    };

    serverProcess.stdout.on('data', onChunk);
    serverProcess.stderr.on('data', (chunk) => {
      process.stderr.write(chunk.toString());
    });
    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      if (!finished) {
        reject(new Error(`dev:wiki exited before Playwright could start (code ${code ?? 1}).`));
      }
    });
  });

  try {
    const baseURL = await startup;
    const exitCode = await runPlaywright(baseURL);
    cleanup();
    process.exit(exitCode);
  } catch (error) {
    cleanup();
    throw error;
  }
}

await main();