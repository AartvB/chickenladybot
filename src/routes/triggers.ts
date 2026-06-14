import { Hono } from 'hono';
import type { OnAppInstallRequest, 
  OnAppUpgradeRequest,
  TriggerResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
/**import { checkPostCount } from '../core/counting';*/
  
export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  await redis.zAdd('posts', {member: 't3_1tkhkh9', score: 0 }); // Add a dummy post to initialize the sorted set

  return c.json<TriggerResponse>(
    {
      status: 'success',
    },
    200
  );
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log('App upgraded in subreddit: r/' + input.subreddit?.name);

  await redis.del('posts'); // FIXME: REMOVE THIS LINE! But for testing, empty the set of all posts
  await redis.del('posts-of-Aartvb') // FIXME: Remove this line as well, it's only for testing to reset the count of posts by the bot
  await redis.del('new_post_queue'); // Clear the queue of new posts to be processed // FIXME: _ -> -
  await redis.del('streak-queue'); // Clear the queue of new posts to be processed

  await redis.set('streak-handler-lock', 'open'); // Ensure the lock for the new post handler is open so it can run after upgrade
  await redis.set('new-post-handler-lock', 'open'); // Ensure the lock for the new post handler is open so it can run after upgrade
  await redis.set('current-count', '0'); // Reset the current count to 0
  await redis.set('current-count-link', 'https://www.reddit.com/r/countwithchickenlady/comments/1iulihu'); // Reset the current count link to the correct post
  await redis.set('current-count-post-id', '1tyqxix');
  await redis.set('subredditname', input.subreddit?.name || ''); // Store the subreddit name in the database for later use in counting logic, to avoid relying on context.subredditName which might not always be available in the counting code
  await redis.set('new-post-limit', '10'); // Set the limit for number of new posts to process at once, to avoid long processing times if there are a lot of new posts.
  // FIXME: set current-count to the correct count based on the existing posts in the subreddit, in case the bot was offline for a while and missed some posts.

  return c.json<TriggerResponse>(
    {
      status: 'success',
    },
    200
  );
});

/**
triggers.post('/on-post-submit', async (c) => {
  const input = await c.req.json<OnPostSubmitRequest>();
  const post = input.post;
  if (post == undefined) {
    console.log('I was triggered for a new post, but no post was found!')
    return;
  }
  checkPostCount(post.id);
});
*/