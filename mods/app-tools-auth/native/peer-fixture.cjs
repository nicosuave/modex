// Test-only MCP client: connect to the fixture socket, then remain alive while
// the host checks the actual kernel audit token and process ancestry.
const net = require('node:net');
const readline = require('node:readline');
const socket = net.connect(process.argv[2]);
socket.on('connect', () =>
  socket.write(JSON.stringify({ pid: process.pid, executable: process.execPath })),
);
socket.on('error', () => process.exit(1));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id == null) return;
  const result =
    request.method === 'initialize'
      ? {
          protocolVersion: '2024-11-05',
          capabilities: {},
          serverInfo: { name: 'native-auth-fixture', version: '1' },
        }
      : { tools: [] };
  // Keep initialization pending while Security validates the live process. A
  // status-only app-server request otherwise tears down this temporary MCP
  // client immediately after initialization, correctly triggering a denial.
  const reply = () =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
  if (request.method === 'initialize') setTimeout(reply, 5000);
  else reply();
});
