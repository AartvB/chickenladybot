import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { redis } from '@devvit/web/server';
import { DBVersion, updateTargetPost, isInSoftShutdown, isInHardShutdown } from '../core/helpers';

export const forms = new Hono();

// FIXME: Actually implement the shutdown functionality. Also implement it in Timer, which should be renamed to 

forms.post('/deactivate-hard-shutdown', async (c) => {
  if (await isInHardShutdown()) {
    const values = await c.req.json<{softShutdown: boolean}>();
    let uiResponse: string;
    if (values.softShutdown) {
      await redis.set(`shutdown-lock-v${await DBVersion()}`, 'soft');
      uiResponse = 'Hard shutdown mode ended. The bot is now in soft shutdown mode.';
    }
    else {
      await redis.set(`shutdown-lock-v${await DBVersion()}`, 'open');
      uiResponse = 'Hard shutdown mode ended. The bot is now running normally.';
    }
      await updateTargetPost();
    return c.json<UiResponse>({ showToast: uiResponse }, 200);
  }
  else { return c.json<UiResponse>({ showToast: 'The bot is not in hard shutdown mode (anymore), so there is nothing to deactivate.',}, 200); }
});

forms.post('/handle-soft-shutdown', async (c) => {
  if (await isInSoftShutdown()) {
    const values = await c.req.json<{shutdownChoice: string}>();
    let uiResponse: string;
    if (values.shutdownChoice == 'end') {
      await redis.set(`shutdown-lock-v${await DBVersion()}`, 'open');
      uiResponse = 'Soft shutdown mode ended. The bot is now running normally.';
    }
    else if (values.shutdownChoice == 'hard') {
      await redis.set(`shutdown-lock-v${await DBVersion()}`, 'hard');
      uiResponse = 'Soft shutdown mode ended. The bot is now in hard shutdown mode.';
    }
    else { return c.json<UiResponse>({ showToast: 'Invalid choice. Please try again.',}, 200); }
    await updateTargetPost();
    return c.json<UiResponse>({ showToast: uiResponse }, 200);
  }
  else { return c.json<UiResponse>({ showToast: 'The bot is not in soft shutdown mode (anymore), so there is nothing to handle.',}, 200); }
});

forms.post('/activate-shutdown', async (c) => {
  if (await isInSoftShutdown()) { return c.json<UiResponse>({ showToast: 'The bot is already in shutdown mode, so there is nothing to activate.',}, 200); }
  else {
    const values = await c.req.json<{hardShutdown: boolean}>();
    let uiResponse: string;
    if (values.hardShutdown) {
      await redis.set(`shutdown-lock-v${await DBVersion()}`, 'hard');
      uiResponse = 'Hard shutdown mode activated. The bot will not process any new posts.';
    }
    else {
      await redis.set(`shutdown-lock-v${await DBVersion()}`, 'soft');
      uiResponse = 'Soft shutdown mode activated. The bot will not process any new posts.';
    }
    await updateTargetPost();
    return c.json<UiResponse>({ showToast: uiResponse }, 200);
  }
});