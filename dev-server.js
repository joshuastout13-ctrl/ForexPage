import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function handleApiRequest(req, res, urlPath) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(parsedUrl.searchParams.entries());

  let bodyData = '';
  for await (const chunk of req) {
    bodyData += chunk;
  }
  if (bodyData) {
    try {
      req.body = JSON.parse(bodyData);
    } catch {
      req.body = bodyData;
    }
  } else {
    req.body = {};
  }

  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (data) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(data));
    return res;
  };

  let relPath = urlPath.replace(/^\/api/, '');
  if (!relPath) relPath = '/';

  let resolvedFile = null;

  const possiblePaths = [
    path.join(__dirname, 'api', `${relPath}.js`),
    path.join(__dirname, 'api', relPath, 'index.js'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      resolvedFile = p;
      break;
    }
  }

  if (!resolvedFile) {
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const tryFile1 = path.join(__dirname, 'api', parts.slice(0, parts.length - 1).join('/'), '[id].js');
      if (fs.existsSync(tryFile1)) {
        resolvedFile = tryFile1;
        req.query.id = parts[parts.length - 1];
      } else if (parts.length >= 3) {
        const tryFile2 = path.join(__dirname, 'api', parts[0], parts[1], '[id]', parts[3] + '.js');
        if (fs.existsSync(tryFile2)) {
          resolvedFile = tryFile2;
          req.query.id = parts[2];
        }
      }
    }
  }

  if (!resolvedFile) {
    return res.status(404).json({ error: `API route ${urlPath} not found` });
  }

  try {
    const fileUrl = 'file:///' + resolvedFile.replace(/\\/g, '/') + '?v=' + Date.now();
    const module = await import(fileUrl);
    const handler = module.default;
    if (typeof handler === 'function') {
      await handler(req, res);
    } else {
      res.status(500).json({ error: `Handler in ${resolvedFile} is not a function` });
    }
  } catch (err) {
    console.error(`[API Error] ${urlPath}:`, err);
    if (!res.writableEnded) {
      res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  console.log(`[${req.method}] ${pathname}`);

  if (pathname.startsWith('/api/') || pathname === '/api') {
    return handleApiRequest(req, res, pathname);
  }

  let filePath;
  if (pathname === '/admin' || pathname === '/admin/') {
    filePath = path.join(__dirname, 'admin.html');
  } else {
    const potentialFile = path.join(__dirname, pathname);
    if (pathname !== '/' && fs.existsSync(potentialFile) && fs.statSync(potentialFile).isFile()) {
      filePath = potentialFile;
    } else {
      filePath = path.join(__dirname, 'index.html');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Local Dev Server running at: http://localhost:${PORT}`);
  console.log(`   - Investor Portal: http://localhost:${PORT}`);
  console.log(`   - Admin Dashboard: http://localhost:${PORT}/admin\n`);
});
