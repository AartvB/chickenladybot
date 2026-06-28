import { Hono } from 'hono';
import type { OnAppInstallRequest, OnAppUpgradeRequest, OnPostDeleteRequest, TriggerResponse } from '@devvit/web/shared';
import { redis } from '@devvit/web/server';
import { addToEndOfQueue, DBVersion } from '../core/helpers';
  
export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log('App upgraded in subreddit: r/' + input.subreddit?.name);

  const databaseVersion = '1';
  await redis.set('database-version', databaseVersion);

  await redis.del(`posts-v${databaseVersion}`); // FIXME: REMOVE THIS LINE! But for testing, empty the set of all posts
  await redis.del(`posts-of-Aartvb-v${databaseVersion}`); // FIXME: Remove this line as well, it's only for testing to reset the count of posts by the bot
  await redis.del(`new-post-queue-v${databaseVersion}`); // Clear the queue of new posts to be processed
  await redis.del(`streak-queue-v${databaseVersion}`); // Clear the queue of new posts to be processed
  await redis.del(`posts-per-user-v${databaseVersion}`);

  await redis.set(`streak-handler-lock-v${databaseVersion}`, 'open'); // Ensure the lock for the new post handler is open so it can run after upgrade
  await redis.set(`new-post-handler-lock-v${databaseVersion}`, 'open'); // Ensure the lock for the new post handler is open so it can run after upgrade
  await redis.set(`current-count-v${databaseVersion}`, '0'); // Reset the current count to 0
  await redis.set(`current-count-link-v${databaseVersion}`, 'https://www.reddit.com/r/countwithchickenlady/comments/1iulihu'); // Reset the current count link to the correct post
  await redis.set(`current-count-post-id-v${databaseVersion}`, '1tyqxix');
  await redis.set(`subredditname-v${databaseVersion}`, input.subreddit?.name || ''); // Store the subreddit name in the database for later use in counting logic, to avoid relying on context.subredditName which might not always be available in the counting code
  await redis.set(`new-post-limit-v${databaseVersion}`, '10'); // Set the limit for number of new posts to process at once, to avoid long processing times if there are a lot of new posts.
  await redis.set(`current-background-task-v${databaseVersion}`, 'flair'); // Set the current background task to flair, to ensure the bot starts with the correct task after upgrade
  await redis.set(`background-task-tracker-v${databaseVersion}`, '0'); // Reset the background task tracker, to ensure the bot starts with the correct task after upgrade
  // FIXME: set current-count to the correct count based on the existing posts in the subreddit, in case the bot was offline for a while and missed some posts.

  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-post-delete', async (c) => {
  const input = await c.req.json<OnPostDeleteRequest>();
  const dbVersion = await DBVersion();
  const postId = input.postId;
  let timestamp_str = input.createdAt;
  let timestamp: number;
  if (timestamp_str) { timestamp = new Date(timestamp_str).getTime(); }
  else { timestamp = await redis.zScore(`posts-v${dbVersion}`, postId) || Date.now(); }

  console.log(`Post deleted: ${postId} at ${timestamp}. str: ${timestamp_str}`);

  if (timestamp > Date.now() - 10 * 60000) { await addToEndOfQueue(`early-deleted-post-queue-v${dbVersion}`, postId); } // TODO: Remove magic number 10
  else { await redis.zAdd(`late-deleted-post-queue-v${dbVersion}`, {member: postId, score: Date.now()}); }

  return c.json<TriggerResponse>({status: 'success',}, 200);
});