const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
let currentDir = process.argv[2] || process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function getFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const txtFiles = entries.filter(e => e.isFile() && e.name.endsWith('.txt'));
  const subDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  // Detect patterns
  const hasChapterFiles = txtFiles.some(f => /第\d+[章回节卷]/.test(f.name));
  const hasNumberPrefix = txtFiles.some(f => /^\d+[-_.]/.test(f.name));
  const hasDatePrefix = txtFiles.some(f => /^\d{4}[-_.]?\d{2}[-_.]?\d{2}/.test(f.name));
  const hasBracketPrefix = txtFiles.some(f => /^[【\[]/.test(f.name));

  // For number-prefix files, find all unique prefixes
  const prefixCounts = {};
  if (hasNumberPrefix) {
    for (const f of txtFiles) {
      const m = f.name.match(/^(\d+)[-_.]/);
      if (m) {
        const p = m[1];
        prefixCounts[p] = (prefixCounts[p] || 0) + 1;
      }
    }
  }

  // Smart prefix grouping: if a prefix has multiple files, group them together
  const prefixGroups = {};
  for (const [p, count] of Object.entries(prefixCounts)) {
    if (count >= 2) prefixGroups[p] = true;
  }

  const categorized = [];
  for (const entry of txtFiles) {
    const file = entry.name;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').length;
    const name = file.replace('.txt', '');

    let category = '文件';
    let displayName = name;
    let sortKey = name;

    if (hasChapterFiles) {
      // Novel mode: detect chapter files
      const chMatch = name.match(/第(\d+)[章回节卷]/);
      if (chMatch) {
        category = '正文章节';
        const chNum = chMatch[1];
        displayName = `第${chNum}${name[name.indexOf(chMatch[0]) + chMatch[0].length - 1] || '章'}`;
        // Try to extract a chapter title after the chapter number
        const afterCh = name.substring(name.indexOf(chMatch[0]) + chMatch[0].length);
        const titleMatch = afterCh.match(/^[:：\-\s]*(.+)/);
        if (titleMatch && titleMatch[1].trim()) {
          displayName += '：' + titleMatch[1].trim();
        }
        sortKey = `z-${chNum.padStart(6, '0')}`;
      } else {
        // Non-chapter files in a novel folder → "设定与资料"
        category = '设定与资料';
      }
    } else if (hasDatePrefix) {
      // Date-prefix mode: group by year-month (must check before number-prefix)
      const m = name.match(/^(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/);
      if (m) {
        category = `${m[1]}年${m[2]}月`;
        displayName = name;
        sortKey = name;
      }
    } else if (hasNumberPrefix && Object.keys(prefixGroups).length > 0) {
      // Number-prefix mode: group by prefix number
      const m = name.match(/^(\d+)[-_.](.*)/);
      if (m && prefixGroups[m[1]]) {
        category = `第${m[1]}组`;
        displayName = m[2] || name;
        sortKey = `${m[1]}-${m[2] || name}`;
      }
    } else if (hasBracketPrefix) {
      // Bracket-prefix mode: group by bracket content
      const m = name.match(/^[【\[]([^】\]】]+)[】\]]/);
      if (m) {
        category = m[1];
        displayName = name.replace(/^[【\[][^】\]】]+[】\]]\s*/, '');
        sortKey = name;
      }
    }

    // For "文件" category with many files, try to group by common prefix
    if (category === '文件' && txtFiles.length > 8) {
      // Find longest common prefix among remaining uncategorized files
      const dashIdx = name.indexOf('-');
      const usIdx = name.indexOf('_');
      const sepIdx = dashIdx >= 0 ? dashIdx : usIdx;
      if (sepIdx > 0 && sepIdx < name.length - 1) {
        const prefix = name.substring(0, sepIdx);
        // Check if at least 2 other files share this prefix
        const shareCount = txtFiles.filter(f => {
          const fn = f.name.replace('.txt', '');
          const di = fn.indexOf('-');
          const ui = fn.indexOf('_');
          const si = di >= 0 ? di : ui;
          return si > 0 && fn.substring(0, si) === prefix;
        }).length;
        if (shareCount >= 2) {
          category = prefix;
          displayName = name.substring(sepIdx + 1) || name;
        }
      }
    }

    const chapterMatch = name.match(/第(\d+)[章回节卷]/);
    if (chapterMatch) sortKey = `z-${chapterMatch[1].padStart(6, '0')}`;

    categorized.push({
      file, name, displayName, category, sortKey,
      size: stat.size, lines,
      mtime: stat.mtime.toISOString(),
    });
  }
  categorized.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'zh-CN'));
  return { files: categorized, subDirs, currentDir: dir };
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (url.pathname === '/api/files') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getFiles(currentDir)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (url.pathname === '/api/file') {
    const name = url.searchParams.get('name');
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      res.writeHead(400); res.end('Bad request'); return;
    }
    const filePath = path.join(currentDir, name + '.txt');
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const content = fs.readFileSync(filePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
  } else if (url.pathname === '/api/set-folder' && req.method === 'POST') {
    const body = await parseBody(req);
    try {
      const { folder } = JSON.parse(body);
      if (!folder || typeof folder !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请提供文件夹路径' }));
        return;
      }
      const resolved = path.resolve(folder);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '文件夹不存在: ' + resolved }));
        return;
      }
      currentDir = resolved;
      console.log(`Folder changed to: ${currentDir}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getFiles(currentDir)));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (url.pathname.startsWith('/img/')) {
    const imgName = decodeURIComponent(url.pathname.replace('/img/', ''));
    const imgPath = path.join(currentDir, imgName);
    if (!fs.existsSync(imgPath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(imgPath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(imgPath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Novel Viewer running at http://localhost:${PORT}`);
});
