const fetch = global.fetch;

module.exports = async (req, res) => {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  // Handle browser preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle GET readiness check
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Webhook endpoint ready' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH = 'main' } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({ error: 'GitHub environment variables not configured on Vercel' });
  }

  try {
    const body = req.body || {};
    
    // Handle connection test pings or handshakes gracefully
    if (!body.slug && !body.content && !body.updates && Object.keys(body).length === 0) {
      return res.status(200).json({ success: true, message: 'Webhook connection verified successfully' });
    }

    const updates = body.updates || [body];

    for (const update of updates) {
      const filePath = update.path || `content/${update.slug || 'page'}.html`;
      const fileContent = update.content || '';
      const commitMessage = update.message || `SEO Auto-update: ${filePath}`;

      const fileUri = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;

      // Check if file already exists to get its SHA
      let sha = null;
      const getRes = await fetch(`${fileUri}?ref=${GITHUB_BRANCH}`, {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': 'Vercel-Webhook-Agent',
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
      }

      // Create or update file on GitHub
      const putRes = await fetch(fileUri, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': 'Vercel-Webhook-Agent',
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: commitMessage,
          content: Buffer.from(fileContent).toString('base64'),
          branch: GITHUB_BRANCH,
          ...(sha ? { sha } : {})
        })
      });

      if (!putRes.ok) {
        const errData = await putRes.json();
        throw new Error(`Failed to update ${filePath} on GitHub (${putRes.status}): ${errData.message}`);
      }
    }

    return res.status(200).json({ success: true, message: 'Content committed to GitHub successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Webhook processing failed', details: err.message });
  }
};
