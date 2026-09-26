const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.LOG_PATH || path.join(__dirname, '..', '..', 'data', 'service.log');
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
const stream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function log(entry) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  stream.write(line + '\n');
  // Also to stdout so `docker compose logs` shows it live.
  console.log(line);
}

// Express middleware: logs one line per request/response, including status
// code and total request duration. This is the per-request log the brief
// requires ("Logging of every request handled by your service") and it's
// what JMeter .jtl results must reconcile against.
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    log({
      type: 'request',
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
  next();
}

module.exports = { log, requestLogger, LOG_PATH };
