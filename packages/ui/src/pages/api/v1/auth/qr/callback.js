export default async function handler(req, res) {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Successful</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              background: #000;
              color: #fff;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              height: 100vh;
              margin: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 20px;
              text-align: center;
            }
            .success-icon {
              width: 60px;
              height: 60px;
              border-radius: 50%;
              background: #1DB954;
              display: flex;
              align-items: center;
              justify-content: center;
              margin-bottom: 20px;
            }
            h1 { font-size: 24px; margin-bottom: 16px; }
            p { color: rgba(255,255,255,0.7); }
          </style>
        </head>
        <body>
          <div class="success-icon">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1>Authentication Successful</h1>
          <p>You can close this window and return to your desktop browser.</p>
        </body>
      </html>
    `;
  
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  }