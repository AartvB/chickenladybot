import { Hono } from 'hono';
import type { T3, UiResponse } from '@devvit/web/shared';
import { reddit, redis } from '@devvit/web/server';
import { DBVersion, updateTargetPost, isInSoftShutdown, isInHardShutdown } from '../core/helpers';
import { addPostToDatabase } from '../core/counting';
import { removePostFromDatabase } from '../core/deletion';

export const forms = new Hono();

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

forms.post('/add-post-to-streak-database', async (c) => {
  const dbVersion = await DBVersion();
  const values = await c.req.json<{postId?: string}>();
  if (values.postId == undefined) { return c.json<UiResponse>({ showToast: 'No post ID provided. Please try again.',}, 200); }
  const targetPostId = "t3_" + values.postId;
  let targetPost;
  try { targetPost = await reddit.getPostById(targetPostId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  const alreadyInDatabase = await redis.zScore(`posts-v${dbVersion}`, targetPostId as T3) != undefined;
  if (alreadyInDatabase) { return c.json<UiResponse>({ showToast: 'The provided post ID is already in the streak database. Please try again.',}, 200); }  
  const postNumber = parseInt(targetPost.title);
  if (isNaN(postNumber)) { return c.json<UiResponse>({ showToast: 'The provided post ID does not correspond to a valid counting post. Please try again.',}, 200); }
  const authorName = targetPost.authorName;
  const timestamp = targetPost.createdAt.getTime();

  await redis.zRem(`early-deleted-post-queue-v${dbVersion}`, [targetPostId as T3]);
  await redis.zRem(`late-deleted-post-queue-v${dbVersion}`, [targetPostId as T3]);
  await redis.zRem(`early-deleted-posts-v${dbVersion}`, [targetPostId as T3]);

  await addPostToDatabase(targetPostId as T3, postNumber, authorName, timestamp);

  return c.json<UiResponse>({ showToast: `Added post ${targetPostId} to the streak database.` }, 200);
});

forms.post('/remove-post-from-streak-database', async (c) => {
  const dbVersion = await DBVersion();
  const values = await c.req.json<{postId?: string}>();
  if (values.postId == undefined) { return c.json<UiResponse>({ showToast: 'No post ID provided. Please try again.',}, 200); }
  const targetPostId = "t3_" + values.postId;
  let targetPost;
  try { targetPost = await reddit.getPostById(targetPostId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  const alreadyInDatabase = await redis.zScore(`posts-v${dbVersion}`, targetPostId as T3) != undefined;
  if (!alreadyInDatabase) { return c.json<UiResponse>({ showToast: 'The provided post ID is not in the streak database. Please try again.',}, 200); }
  await removePostFromDatabase(targetPostId as T3, true);
  return c.json<UiResponse>({ showToast: `Removed post ${targetPostId} from the streak database.` }, 200);
});