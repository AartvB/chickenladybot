import { Hono } from 'hono';
import { handleStreak } from '../core/streak';
import { handleNewPosts, detectNewPosts } from '../core/counting';
import { redis, type TaskResponse } from '@devvit/web/server';
import { ContentfulStatusCode } from 'hono/utils/http-status';

export const tasks = new Hono();

tasks.post('/new-post-handler', async (c) => {
  // Only do this if this action is not currently being executed in parralel
  const lock_key = 'new-post-handler-lock'; // FIXME: Add timer remove lock after 35 seconds just in case something goes wrong and the lock doesn't get released
  if (await redis.get(lock_key) == 'locked') {
    return c.json<TaskResponse>({ status: 'locked' }, 200);
  }
  await redis.set(lock_key, 'locked');

  let result;
  if (await redis.zCard('new_post_queue') > 0) { result = await handleNewPosts(); } // Handle the posts in the queue
  else { result = await detectNewPosts(); } // Check for new posts and add them to the queue

  await redis.set(lock_key, 'open');

  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});

tasks.post('/streak-handler', async (c) => {
  const lock_key = 'streak-handler-lock'; // FIXME: Add timer remove lock after 35 seconds just in case something goes wrong and the lock doesn't get released
  if (await redis.get(lock_key) == 'locked') {
    return c.json<TaskResponse>({ status: 'locked' }, 200);
  }
  await redis.set(lock_key, 'locked');

  const result = await handleStreak();

  await redis.set(lock_key, 'open');

  return c.json<TaskResponse>({ status: result['status'], message: result['message']}, result['number'] as ContentfulStatusCode);
});