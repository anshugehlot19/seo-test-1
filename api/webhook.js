module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      res.status(200).json({ status: 'ok', message: 'Webhook endpoint ready' });
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';

    if (!token || !owner || !repo) {
      res.status(500).json({
        error: 'Missing required environment variables: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO'
      });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    if (!body || typeof body !== 'object') body = {};

    // Normalize incoming updates:
    // Supports: { path, content } OR { updates: [{ path, content, message }] }
    // OR { files: [...] } OR { content } (defaults to index.html)
    let updates = [];
    if (Array.isArray(body.updates)) {
      updates = body.updates;
    } else if (Array.isArray(body.files)) {
      updates = body.files;
    } else if (body.path && typeof body.content === 'string') {
      updates = [{ path: body.path, content: body.content, message: body.message }];
    } else if (typeof body.content === 'string') {
      updates = [{ path: body.path || 'index.html', content: body.content, message: body.message }];
    } else if (body.html && !body.content) {
      updates = [{ path: body.path || 'index.html', content: body.html, message: body.message }];
    }

    if (!updates.length) {
      res.status(400).json({
        error: 'No content updates provided. Send JSON with { path, content } or { updates: [{ path, content }] }.'
      });
      return;
    }

    const apiBase = 'https://api.github.com';
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'outscale-digital-webhook',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    const results = [];

    for (const update of updates) {
      const filePath = String(update.path || 'index.html').replace(/^\/+/, '');
      const fileContent = typeof update.content === 'string' ? update.content : null;
      if (!filePath || fileContent === null) {
        results.push({ path: filePath || null, status: 'skipped', reason: 'Missing path or string content' });
        continue;
      }

      const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
      const getUrl = `${apiBase}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

      let sha;
      const getResp = await fetch(getUrl, { method: 'GET', headers });
      if (getResp.ok) {
        const existing = await getResp.json();
        sha = existing.sha;
      } else if (getResp.status !== 404) {
        const errText = await getResp.text();
        throw new Error(`Failed to fetch ${filePath} from GitHub (${getResp.status}): ${errText}`);
      }

      const putUrl = `${apiBase}/repos/${owner}/${repo}/contents/${encodedPath}`;
      const message = update.message || `chore: update ${filePath} via webhook`;
      const contentBase64 = Buffer.from(fileContent, 'utf8').toString('base64');

      const putBody = {
        message,
        content: contentBase64,
        branch
      };
      if (sha) putBody.sha = sha;

      const putResp = await fetch(putUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify(putBody)
      });

      const putData = await putResp.json().catch(() => ({}));
      if (!putResp.ok) {
        throw new Error(`Failed to update ${filePath} on GitHub (${putResp.status}): ${JSON.stringify(putData)}`);
      }

      results.push({
        path: filePath,
        status: 'updated',
        commit: putData.commit && putData.commit.sha ? putData.commit.sha : null
      });
    }

    res.status(200).json({
      status: 'ok',
      message: 'Content updates committed successfully',
      branch,
      results
    });
  } catch (error) {
    res.status(500).json({
      error: 'Webhook processing failed',
      details: error && error.message ? error.message : String(error)
    });
  }
};
