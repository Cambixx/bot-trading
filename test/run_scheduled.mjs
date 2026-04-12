import { handler } from '../netlify/functions/trader-bot.js';

async function run() {
  console.log('Invoking scheduled-analysis handler (test)');

  try {
    const res = await handler({}, {});
    console.log('Handler response:', res);
  } catch (err) {
    console.error('Handler threw:', err);
  }
}

run();
