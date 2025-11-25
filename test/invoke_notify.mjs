import { handler } from '../netlify/functions/scheduled-analysis.js';

async function run() {
  console.log('Invoking scheduled-analysis handler (POST notify)');

  const fakeSignals = [
    {
      symbol: 'TESTNOTIFYUSDT',
      price: 999.99,
      score: 100,
      reasons: ['Prueba automática E2E']
    }
  ];

  const event = {
    httpMethod: 'POST',
    body: JSON.stringify({ signals: fakeSignals })
  };
  // If NOTIFY_SECRET present in env, include it in headers to simulate client
  const secret = process.env.NOTIFY_SECRET || null;
  if (secret) event.headers = { 'x-notify-secret': secret };

  try {
    const res = await handler(event, {});
    console.log('Handler response:', res);
  } catch (err) {
    console.error('Handler threw:', err);
  }
}

run();
