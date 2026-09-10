// Test-only signed Node host. The production addon uses getpid(), so a fixture
// must itself own the socket and directly launch the real vendor codex binary.
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const options = JSON.parse(process.argv[2]);
const children = [];
if (options.mode === 'relay') {
  const child = spawn(options.command, options.args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code ?? 1));
  process.on('SIGTERM', () => {
    child.kill();
    process.exit();
  });
} else {
  const addon = require(options.addon);
  let stderr = '';
  let finished = false;
  const server = net.createServer((socket) => {
    socket.once('data', (data) => {
      const result = addon.authorizeSocketPeer(socket._handle.fd);
      if (options.expected.authorized && !result.authorized) {
        process.stderr.write('Unexpected peer denial: ' + data + '\n');
      }
      finish(result);
      socket.destroy();
    });
  });
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    for (const child of children) child.kill();
    server.close();
    process.stdout.write(JSON.stringify(result) + '\n');
    setTimeout(() => process.exit(result.authorized === undefined ? 1 : 0), 50);
  }
  const timeout = setTimeout(() => finish({ error: 'fixture-timeout', stderr }), 25000);
  server.listen(options.socket, () => {
    const peerArgs = [path.join(__dirname, 'peer-fixture.cjs'), options.socket];
    if (options.mode === 'wrong-parent') {
      const child = spawn(
        process.execPath,
        [__filename, JSON.stringify({ mode: 'relay', command: options.node, args: peerArgs })],
        { stdio: 'ignore' },
      );
      children.push(child);
      return;
    }
    const config = `mcp_servers.native_auth_fixture={command=${JSON.stringify(options.peerNode || options.node)},args=${JSON.stringify(peerArgs)},startup_timeout_sec=10}`;
    const args = ['app-server', '--stdio', '-c', config];
    let command = options.codex;
    let commandArgs = args;
    if (options.mode === 'wrong-ancestor') {
      command = process.execPath;
      commandArgs = [__filename, JSON.stringify({ mode: 'relay', command: options.codex, args })];
    }
    const child = spawn(command, commandArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_HOME: options.home },
    });
    children.push(child);
    child.stderr.on('data', (bytes) => {
      stderr = (stderr + bytes).slice(-12000);
    });
    child.on('error', (error) => finish({ error: error.message }));
    let buffer = '';
    const send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdout.on('data', (bytes) => {
      buffer += bytes;
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        let response;
        try {
          response = JSON.parse(line);
        } catch {
          continue;
        }
        if (response.id === 1) {
          if (response.error) return finish({ error: response.error, stderr });
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'mcpServerStatus/list', params: {} });
        }
        if (response.id === 2 && response.error) finish({ error: response.error, stderr });
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'modex_native_auth_test', version: '1' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}
