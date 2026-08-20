import { Hono } from 'hono';
import type { OnAppInstallRequest, OnAppUpgradeRequest, OnPostDeleteRequest, T3, TriggerResponse } from '@devvit/web/shared';
import { reddit, redis } from '@devvit/web/server';
import { addToEndOfQueue, botExplainer, DBVersion, isPostDeletedEarly, updateTargetPost } from '../core/helpers';
  
export const triggers = new Hono();

// TODO: Write code to update redis database when the database has been restored after accidentally removing the bot from the subreddit.

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  const dbVersion = '1';
  await redis.set('database-version', dbVersion);
  await redis.set('new-post-handler-lock-v' + dbVersion, 'open');
  await redis.set('streak-handler-lock-v' + dbVersion, 'open');
  await redis.set('deleted-post-handler-lock-v' + dbVersion, 'open');
  await redis.set('background-task-handler-lock-v' + dbVersion, 'open');
  await redis.set('shutdown-lock-v' + dbVersion, 'hard');
  await redis.set('current-background-task-v' + dbVersion, 'setup');
  await redis.set('new-post-limit-v' + dbVersion, '10');
  await redis.set('current-count-v' + dbVersion, '0');
  if (input.subreddit?.name == 'countwithchickenlady') { await redis.set('current-count-post-id-v' + dbVersion, '1iulihu'); }
  else if (input.subreddit?.name == 'chickenladybot_dev') { await redis.set('current-count-post-id-v' + dbVersion, '1vtbmkf'); }
  else {
    const post = await reddit.submitPost({subredditName: input.subreddit?.name as string, title: 'Use this to see what the next number is (automatically updated)', text: 'test', runAs: 'APP'});
    post.approve();
    post.sticky();
    await redis.set('current-count-post-id-v' + dbVersion, post.id);
  }

  console.log(`Current count post id for subreddit ${input.subreddit?.name} is ${await redis.get('current-count-post-id-v' + dbVersion)}`);

  await updateTargetPost();
  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log('App upgraded in subreddit: r/' + input.subreddit?.name);

  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-post-delete', async (c) => {
  // When a post gets deleted, add it to the early (within 10 minutes) or late (after 10 minutes) queue.
  const input = await c.req.json<OnPostDeleteRequest>();
  const dbVersion = await DBVersion();
  const postId = input.postId;

  if (await redis.zScore(`posts-v${dbVersion}`, postId) == undefined) { return c.json<TriggerResponse>({status: 'success',}, 200); } // It is not in the post database, so it was removed by the bot. It might also be the case that it was deleted while it was being added to the posts database, but then it will be caught by the recurring deleted-post-handler task.

  const timestamp_str = input.createdAt;
  let timestamp: number;
  if (timestamp_str) { timestamp = new Date(timestamp_str).getTime(); }
  else { timestamp = await redis.zScore(`posts-v${dbVersion}`, postId) || Date.now(); }

  if (timestamp > Date.now() - 10 * 60000) { await addToEndOfQueue(`early-deleted-post-queue-v${dbVersion}`, postId); } // TODO: Remove magic number 10
  else if (!(await isPostDeletedEarly(postId as T3))) { 
    await redis.zAdd(`late-deleted-post-queue-v${dbVersion}`, {member: postId, score: Date.now()});
    let message = `This post has been removed by you or a moderator after 10 minutes of posting it. Therefore this post will still count as your post for this day and keeps contributing to your streak. You may post again at the next calendar day.` // TODO: Remove magic number 10
    message += await botExplainer();
    await reddit.submitComment({id: postId as T3, text: message, runAs: 'APP'});
  }

  return c.json<TriggerResponse>({status: 'success',}, 200);
});