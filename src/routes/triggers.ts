import { Hono } from 'hono';
import type { OnAppInstallRequest, OnAppUpgradeRequest, OnPostDeleteRequest, T3, TriggerResponse } from '@devvit/web/shared';
import { reddit, redis, settings } from '@devvit/web/server';
import { addSubscription, addToEndOfQueue, botExplainer, botHelp, DBVersion, formatDateTime, isPostDeletedEarly, removeSubscription, updateTargetPost, viewPostWindow } from '../core/helpers';
  
export const triggers = new Hono();

// TODO: Write code to update redis database when the database has been restored after accidentally removing the bot from the subreddit.

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  await reddit.modMail.createConversation({body: `u/ChickenBotOnceADay has been installed in r/${input.subreddit?.name}. This probably means that the bot was removed from the subreddit and then re-added. This means that all of the bot's data is lost. Please put the bot on a hard shutdown, close the subreddit for new posts, and let u/Aartvb contact reddit support to restore the data.`, subject: `CRITICAL WARNING: u/ChickenBotOnceADay app (re)installed in r/${input.subreddit?.name}`, subredditName: input.subreddit?.name as string});

  const dbVersion = '2';
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
    await post.approve();
    await post.sticky();
    await redis.set('current-count-post-id-v' + dbVersion, post.id);
  }

  console.log(`Current count post id for subreddit ${input.subreddit?.name} is ${await redis.get('current-count-post-id-v' + dbVersion)}`);

  await updateTargetPost();
  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-app-upgrade', async (c) => {
  const input = await c.req.json<OnAppUpgradeRequest>();
  console.log('App upgraded in subreddit: r/' + input.subreddit?.name);

//  const dbVersion = await redis.get('database-version');

  return c.json<TriggerResponse>({status: 'success',},200);
});

triggers.post('/on-post-delete', async (c) => {
  // When a post gets deleted, add it to the early (within nMinutesUntilPostCounts minutes) or late (after nMinutesUntilPostCounts minutes) queue. (nMinutesUntilPostCounts in settings, default 10 minutes)

  const input = await c.req.json<OnPostDeleteRequest>();
  const dbVersion = await DBVersion();
  const postId = input.postId;

  if (await redis.zScore(`posts-v${dbVersion}`, postId) == undefined) { return c.json<TriggerResponse>({status: 'success',}, 200); } // It is not in the post database, so it was removed by the bot. It might also be the case that it was deleted while it was being added to the posts database, but then it will be caught by the recurring deleted-post-handler task.

  const timestamp_str = input.createdAt;
  let timestamp: number;
  if (timestamp_str) { timestamp = new Date(timestamp_str).getTime(); }
  else { timestamp = await redis.zScore(`posts-v${dbVersion}`, postId) || Date.now(); }

  let nMinutesUntilPostCounts = await settings.get('nMinutesUntilPostCounts');
  if (nMinutesUntilPostCounts == undefined || typeof nMinutesUntilPostCounts != 'number') { nMinutesUntilPostCounts = 10; }

  if (timestamp > Date.now() - nMinutesUntilPostCounts * 60000) { await addToEndOfQueue(`early-deleted-post-queue-v${dbVersion}`, postId); }
  else if (!(await isPostDeletedEarly(postId as T3))) { 
    await redis.zAdd(`late-deleted-post-queue-v${dbVersion}`, {member: postId, score: Date.now()});
    let message = `This post has been removed by you, a moderator or reddit filters after ${nMinutesUntilPostCounts} minutes of posting it. Therefore this post will still count as your post for this day and keeps contributing to your streak.`

    const post = await reddit.getPostById(postId as T3)
    if (post) {
      const startNextPostTimeframe = await redis.zScore(`start-next-post-timeframe-v${await DBVersion()}`, post.authorName);
      const endNextPostTimeframe = await redis.zScore(`end-next-post-timeframe-v${await DBVersion()}`, post.authorName);
      if (startNextPostTimeframe && endNextPostTimeframe) {
        const now = new Date().valueOf();
        if (endNextPostTimeframe > now) {
          if (startNextPostTimeframe > now) {
            message += ` You can create your next post in ${formatDateTime(startNextPostTimeframe - now)} from now.`;
            message += ` If you create it later than ${formatDateTime(endNextPostTimeframe - now)} from now, you will lose your streak.`;      
          }
          else {
            message += ` If you create your next post later than ${formatDateTime(endNextPostTimeframe - now)} from now, you will lose your streak.`;
          }
        }
        else { message += ' You may post again at the next calendar day.'; }
      }
      else { message += ' You may post again at the next calendar day.'; }
    }
    else { message += ' You may post again at the next calendar day.'; }

    message += await botExplainer();
    const comment = await reddit.submitComment({id: postId as T3, text: message, runAs: 'APP'});
    await comment.distinguish(true);
  }

  return c.json<TriggerResponse>({status: 'success',}, 200);
});

triggers.post('/on-comment-create', async (c) => {
  const input = await c.req.json();
  const username = input.author.name;
  const comment = await reddit.getCommentById(input.comment.id);
  if (!username || !comment) { return c.json<TriggerResponse>({status: 'success',}, 200); }
  if (username == 'chickenbotonceaday') { return c.json<TriggerResponse>({status: 'success',}, 200); }
  const body = comment.body;
  if (body.toLowerCase().includes('!unsubscribe')) {
    await removeSubscription(username);
    const reply = await comment.reply({text: `You have been unsubscribed from streak notifications. You will no longer receive notifications about your streak. If you change your mind, you can always subscribe again using the !subscribe command.${await botExplainer()}`, runAs: 'APP'});
    await reply.distinguish(false);
  }
  else if (body.toLowerCase().includes('!subscribe')) {
    await addSubscription(username);
    const reply = await comment.reply({text: `You have been subscribed to streak notifications. You will now receive notifications about your streak. If you change your mind, you can always unsubscribe using the !unsubscribe command.${await botExplainer()}`, runAs: 'APP'});
    await reply.distinguish(false);
  }
  if (body.toLowerCase().includes('!viewpostwindow')) {
    const postWindow = await viewPostWindow(username);
    if (postWindow.success) {
      const reply = await comment.reply({text: (await viewPostWindow(username)).message+await botExplainer(), runAs: 'APP'});
      await reply.distinguish(false);
    }
    else { await addToEndOfQueue(`view-post-window-queue-v${await DBVersion()}`, input.author.id); }
  }
  if (body.toLowerCase().includes('!help')) {
    const reply = await comment.reply({text: await botHelp() + await botExplainer(), runAs: 'APP'});
    await reply.distinguish(false);
  }

  return c.json<TriggerResponse>({status: 'success',}, 200);
});