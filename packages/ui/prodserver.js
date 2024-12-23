const https = require('https');
const fs = require('fs');
const path = require('path');
const next = require('next');

process.env.NODE_ENV = 'production';
process.env.NEXT_TELEMETRY_DISABLED = 1;
process.chdir(__dirname);

const { config } = require('./.next/required-server-files.json');
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);

const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

const options = {
    key: fs.readFileSync(path.join(__dirname, 'cert.key')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.crt'))
};

const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 3500;

app.prepare().then(() => {
    https.createServer(options, (req, res) => {
        handle(req, res);
    }).listen(port, host, () => {
        console.log(`> Ready on https://${host}:${port}`);
    });
});
