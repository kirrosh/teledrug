/**
 * Error page
 * GET /oauth/google/error?error=XXX
 */
export function handleError(url: URL, headers: Record<string, string>): Response {
  const error = url.searchParams.get('error') || 'Неизвестная ошибка';

  const html = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ошибка авторизации</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #f56565 0%, #c53030 100%);
          padding: 20px;
        }
        .container {
          background: white;
          padding: 48px 40px;
          border-radius: 24px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 480px;
          width: 100%;
        }
        .error-icon {
          font-size: 72px;
          margin-bottom: 24px;
        }
        h1 {
          color: #1a202c;
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        p {
          color: #4a5568;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 8px;
        }
        .error-details {
          margin-top: 20px;
          padding: 16px;
          background: #fff5f5;
          border: 1px solid #feb2b2;
          border-radius: 8px;
          color: #c53030;
          font-size: 14px;
          word-break: break-word;
        }
        .action {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid #e2e8f0;
          color: #718096;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="error-icon">❌</div>
        <h1>Ошибка авторизации</h1>
        <p>К сожалению, не удалось подключить Google Calendar.</p>
        <div class="error-details">
          ${error}
        </div>
        <div class="action">
          Пожалуйста, вернитесь в Telegram и попробуйте снова.
        </div>
      </div>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
