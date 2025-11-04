/**
 * Success page
 * GET /oauth/google/success?session_id=XXX
 */
export function handleSuccess(url: URL, headers: Record<string, string>): Response {
  const html = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Авторизация завершена</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          animation: slideUp 0.4s ease-out;
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .success-icon {
          font-size: 72px;
          margin-bottom: 24px;
          animation: bounce 0.6s ease-out;
          display: inline-block;
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
        h1 {
          color: #1a202c;
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 12px;
          line-height: 1.3;
        }
        p {
          color: #4a5568;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 8px;
        }
        .highlight {
          color: #667eea;
          font-weight: 500;
        }
        .countdown {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid #e2e8f0;
          color: #718096;
          font-size: 14px;
        }
        .countdown strong {
          color: #4a5568;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✅</div>
        <h1>Авторизация завершена!</h1>
        <p>
          <span class="highlight">Google Calendar</span> успешно подключен к вашему аккаунту.
        </p>
        <p style="margin-top: 16px;">
          Теперь вы можете вернуться в Telegram и начать работу с календарем.
        </p>
        <div class="countdown">
          Окно автоматически закроется через <strong><span id="countdown">3</span></strong> секунд...
        </div>
      </div>

      <script>
        let seconds = 3;
        const countdownElement = document.getElementById('countdown');

        const interval = setInterval(() => {
          seconds--;
          if (countdownElement) {
            countdownElement.textContent = seconds.toString();
          }

          if (seconds <= 0) {
            clearInterval(interval);
            window.close();

            setTimeout(() => {
              if (!window.closed) {
                document.body.innerHTML = \`
                  <div class="container">
                    <div class="success-icon">👍</div>
                    <h1>Готово!</h1>
                    <p>Вы можете закрыть эту вкладку и вернуться в Telegram.</p>
                  </div>
                \`;
              }
            }, 500);
          }
        }, 1000);

        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
          setTimeout(() => window.close(), 2000);
        }
      </script>
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
