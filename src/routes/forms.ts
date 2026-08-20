import { Hono } from 'hono';
import type { T3, UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { DBVersion, updateTargetPost, isInSoftShutdown, isInHardShutdown, addToEndOfQueue, getDateTime } from '../core/helpers';
import { addPostToDatabase } from '../core/counting';
import { removePostFromDatabase } from '../core/deletion';

export const forms = new Hono();

forms.post('/deactivate-hard-shutdown', async (c) => {
  console.log(`${getDateTime()}: Received request to deactivate hard shutdown mode.`);
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
    console.log(`${getDateTime()}: Hard shutdown mode deactivated. Bot is now ${values.softShutdown ? 'in soft shutdown mode' : 'running normally'}.`);
    return c.json<UiResponse>({ showToast: uiResponse }, 200);
  }
  else { return c.json<UiResponse>({ showToast: 'The bot is not in hard shutdown mode (anymore), so there is nothing to deactivate.',}, 200); }
});

forms.post('/handle-soft-shutdown', async (c) => {
  console.log(`${getDateTime()}: Received request to handle soft shutdown mode.`);
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
    console.log(`${getDateTime()}: Soft shutdown mode handled. Bot is now ${values.shutdownChoice == 'end' ? 'running normally' : 'in hard shutdown mode'}.`);
    return c.json<UiResponse>({ showToast: uiResponse }, 200);
  }
  else { return c.json<UiResponse>({ showToast: 'The bot is not in soft shutdown mode (anymore), so there is nothing to handle.',}, 200); }
});

forms.post('/activate-shutdown', async (c) => {
  console.log(`${getDateTime()}: Received request to activate shutdown mode.`);
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
    console.log(`${getDateTime()}: Shutdown mode activated. Bot is now ${values.hardShutdown ? 'in hard shutdown mode' : 'in soft shutdown mode'}.`);
    return c.json<UiResponse>({ showToast: uiResponse }, 200);
  }
});

forms.post('/add-post-to-streak-database', async (c) => {
  console.log(`${getDateTime()}: Received request to add a post to the streak database.`);
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

  console.log(`${getDateTime()}: Manually added post ${targetPostId} to the streak database (post number: ${postNumber}, author: ${authorName}, timestamp: ${timestamp}).`);
  return c.json<UiResponse>({ showToast: `Added post ${targetPostId} to the streak database.` }, 200);
});

forms.post('/remove-post-from-streak-database', async (c) => {
  console.log(`${getDateTime()}: Received request to remove a post from the streak database.`);
  const dbVersion = await DBVersion();
  const values = await c.req.json<{postId?: string}>();
  if (values.postId == undefined) { return c.json<UiResponse>({ showToast: 'No post ID provided. Please try again.',}, 200); }
  const targetPostId = "t3_" + values.postId;
  const alreadyInDatabase = await redis.zScore(`posts-v${dbVersion}`, targetPostId as T3) != undefined;
  if (!alreadyInDatabase) { return c.json<UiResponse>({ showToast: 'The provided post ID is not in the streak database. Please try again.',}, 200); }
  await removePostFromDatabase(targetPostId as T3, true);
  console.log(`${getDateTime()}: Manually removed post ${targetPostId} from the streak database.`);
  return c.json<UiResponse>({ showToast: `Removed post ${targetPostId} from the streak database.` }, 200);
});

forms.post('/add-manual-streak', async (c) => {
  console.log(`${getDateTime()}: Received request to add a manual streak.`);

  const dbVersion = await DBVersion();
  const values = await c.req.json<{postId?: string, streak?: number}>();
  if (values.postId == undefined || values.streak == undefined) { return c.json<UiResponse>({ showToast: 'Missing required fields. Please try again.',}, 200); }
  const postId = "t3_" + values.postId;
  let targetPost;
  try { targetPost = await reddit.getPostById(postId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  const streak = values.streak;
  if (streak < 0 || !Number.isInteger(streak)) { return c.json<UiResponse>({ showToast: 'Streak length must be a non-negative integer. Please try again.',}, 200); }
  const subreddit = targetPost.subredditName;
  const streakType = subreddit === context.subredditName ? 'local' : 'COAD';
  const authorName = targetPost.authorName;
  const timestamp = targetPost.createdAt.getTime();

  while (true) {
    const txn = await redis.watch(`other-streaks-of${authorName}-v${dbVersion}`);
    await txn.multi();
    const existingStreaks = await redis.get(`other-streaks-of${authorName}-v${dbVersion}`);
    const streakValues = existingStreaks ? JSON.parse(existingStreaks) : [];
    streakValues.push({ streak: streak, source: streakType, timestamp: timestamp });
    await txn.set(`other-streaks-of${authorName}-v${dbVersion}`, JSON.stringify(streakValues));
    if (await txn.exec()) { break; } // If the transaction was successful, break the loop. Otherwise, retry.
  }

  const postsAfter = await redis.zRange(`posts-of-${authorName}-v${dbVersion}`, timestamp, '+inf', {by: 'score'});
  for (const postInfo of postsAfter) { await addToEndOfQueue(`streak-queue-v${dbVersion}`, postInfo['member']); }

  console.log(`${getDateTime()}: Added a manual ${streakType} streak of length ${streak} for post ${postId} (author: ${authorName}, timestamp: ${timestamp}).`);
  return c.json<UiResponse>({ showToast: `Added a manual ${streakType} streak of length ${streak} for post ${postId}.` }, 200);
});

forms.post('/view-streak-development', async (c) => {  
  console.log(`${getDateTime()}: Received request to view streak development.`);
  const dbVersion = await DBVersion();
  const values = await c.req.json<{authorName: string, timeZone: string, numberOfPosts: number, includePostLink: boolean}>();
  const authorName = values.authorName;
  const numberOfPosts = values.numberOfPosts;
  const includePostLink = values.includePostLink;
  const recentPosts = await redis.zRange(`posts-of-${authorName}-v${dbVersion}`, -numberOfPosts, -1, );
  let streakInfo = `Recent streaks for user ${authorName}:\n\n`;
  for (const postInfo of recentPosts) {
    const postId = postInfo['member'];
    const streakLength = await redis.zScore(`post-streaks-v${dbVersion}`, postId);
    const timestamp = await redis.zScore(`posts-of-${authorName}-v${dbVersion}`, postId);
    const dateStr = timestamp ? new Date(timestamp).toLocaleString('en-US', { timeZone: values.timeZone }) : 'Unknown date';
    if (includePostLink) {
      if (streakLength != undefined) { streakInfo += `${dateStr}, post: https://www.reddit.com/r/${context.subredditName}/comments/${postId}: ${streakLength}.\n\n`; }
      else { streakInfo += `${dateStr}, post: https://www.reddit.com/r/${context.subredditName}/comments/${postId}: Unknown.\n\\n`; }
    }
    else {
      if (streakLength != undefined) { streakInfo += `${dateStr}: ${streakLength}.\n\n`; }
      else { streakInfo += `${dateStr}: Unknown.\n\n`; }
    }
  }
  // TODO: Add COAD streaks to this output
  // TODO: Add local streaks to this output
  // TODO: Add deleted posts to this output, both within and after 10 minutes
  // TODO: Work on formatting of this output to make it more readable
  // TODO: Add option to send it as a private message to the mod instead of displaying it in the form

  return c.json<UiResponse>({
    showForm: {
      name: 'displayStreakDevelopment',
      form: {
        fields: [],
        title: 'Streak Development',
        description: streakInfo,
        acceptLabel: 'Close',
      }
    },
  }, 200);
});

forms.post('/display-streak-development', async (c) => { return c.json<UiResponse>({ showToast: "Streak information displayed." }, 200); });