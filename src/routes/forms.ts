import { Hono } from 'hono';
import type { T1, T3, UiResponse } from '@devvit/web/shared';
import { context, reddit, redis, settings } from '@devvit/web/server';
import { DBVersion, updateTargetPost, isInSoftShutdown, isInHardShutdown, addToEndOfQueue, getDateTime, botExplainer, remindModsAboutMissingSettings, addSubscription, removeSubscription } from '../core/helpers';
import { addPostToDatabase, removePost } from '../core/counting';
import { removePostFromDatabase } from '../core/deletion';
import { reportStreakDevelopment } from '../core/streak';

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
    const txn = await redis.watch(`other-streaks-of-${authorName}-v${dbVersion}`);
    await txn.multi();
    const existingStreaks = await redis.get(`other-streaks-of-${authorName}-v${dbVersion}`);
    const streakValues = existingStreaks ? JSON.parse(existingStreaks) : [];
    streakValues.push({ streak: streak, source: streakType, timestamp: timestamp });
    await txn.set(`other-streaks-of-${authorName}-v${dbVersion}`, JSON.stringify(streakValues));
    if (await txn.exec()) { break; } // If the transaction was successful, break the loop. Otherwise, retry.
  }

  const postsAfter = await redis.zRange(`posts-of-${authorName}-v${dbVersion}`, timestamp, '+inf', {by: 'score'});
  for (const postInfo of postsAfter) { await addToEndOfQueue(`streak-queue-v${dbVersion}`, postInfo['member']); }

  console.log(`${getDateTime()}: Added a manual ${streakType} streak of length ${streak} for post ${postId} (author: ${authorName}, timestamp: ${timestamp}).`);
  return c.json<UiResponse>({ showToast: `Added a manual ${streakType} streak of length ${streak} for post ${postId}.` }, 200);
});

forms.post('/post-as-bot', async (c) => {
  console.log(`${getDateTime()}: Received request to post as bot.`);
  const values = await c.req.json<{title: string, body: string, showModLabel: boolean, stickyPost: boolean, lockPost: boolean, footerChoice: string, customFooter: string}>();
  const title = values.title;
  const text = values.body;
  const showModLabel = values.showModLabel;
  const stickyPost = values.stickyPost;
  const lockPost = values.lockPost;
  const footerChoice = values.footerChoice;
  const customFooter = values.customFooter;
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to post as the bot.', }, 200); }
  if (title == undefined || text == undefined || showModLabel == undefined || stickyPost == undefined || lockPost == undefined || footerChoice == undefined) { return c.json<UiResponse>({ showToast: 'Missing required fields. Please try again.',}, 200); }
  if (footerChoice == 'custom' && customFooter == undefined) { return c.json<UiResponse>({ showToast: 'Missing custom footer text. Please try again.',}, 200); }
  if (footerChoice != 'custom' && customFooter != undefined) { return c.json<UiResponse>({ showToast: 'Custom footer text provided but footer choice is not set to custom. Please try again.',}, 200); }
  let footerText: string;
  if (footerChoice == 'custom') { footerText = `\n\n^(${customFooter})`; }
  else if (footerChoice == 'bot') { footerText = await botExplainer(); }
  else if (footerChoice == 'mod') { footerText = `\n\n^(This piece of content has been created manually by a moderator.)`; }
  else { return c.json<UiResponse>({ showToast: 'Invalid footer choice. Please try again.',}, 200); }
  try {
    const post = await reddit.submitPost({subredditName: context.subredditName, title: title, text: text + footerText, runAs: 'APP'});
    await post.approve();
    if (showModLabel) { await post.distinguish(); }
    if (stickyPost) { await post.sticky(); }
    if (lockPost) { await post.lock(); }
    const postingDateTimeUTC = post.createdAt.toISOString();
    const postInfo = `Posted by u/${username} on ${postingDateTimeUTC} UTC. Mod label ${showModLabel ? '' : 'not '}shown. ${stickyPost ? 'Stickied' : 'Not stickied'}. ${lockPost ? 'Locked' : 'Not locked'}.\n\nPost body:\n\n${text + footerText}`;
    await redis.set(`bot-post-info-${post.id}-version-1-v${DBVersion()}`, postInfo);
    console.log(`${getDateTime()}: u/${username} posted as bot: ${post.id}`);
    return c.json<UiResponse>({ showToast: `You successfully posted as the bot!` }, 200);
  } catch (error) {
    console.error(`${getDateTime()}: Error posting as bot: ${error}`);
    return c.json<UiResponse>({ showToast: `Error posting as bot: ${error}` }, 500);
  }
});

forms.post('/edit-bot-post', async (c) => {
  console.log(`${getDateTime()}: Received request to edit a bot post.`);
  const values = await c.req.json<{postId: string, body: string, showModLabel: boolean, stickyPost: boolean, lockPost: boolean}>();
  const postId = values.postId;
  let post;
  try { post = await reddit.getPostById(postId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  if (post.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'The provided post ID does not correspond to a post made by the bot. Please try again.',}, 200); }
  if (!(await redis.get(`bot-post-info-${post.id}-version-1-v${DBVersion()}`))) { return c.json<UiResponse>({ showToast: 'This post was not made by a moderator as the bot, so it cannot be edited.',}, 200); }
  const text = values.body;
  const showModLabel = values.showModLabel;
  const stickyPost = values.stickyPost;
  const lockPost = values.lockPost;
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to edit a bot post.', }, 200); }
  if (text == undefined || showModLabel == undefined || stickyPost == undefined || lockPost == undefined) { return c.json<UiResponse>({ showToast: 'Missing required fields. Please try again.',}, 200); }
  try {
    await post.edit({text: text});
    if (showModLabel) { await post.distinguish(); }
    else { await post.undistinguish(); }
    if (stickyPost) { await post.sticky(); }
    else { await post.unsticky(); }
    if (lockPost) { await post.lock(); }
    else { await post.unlock(); }
    const editDateTimeUTC = new Date().toISOString();
    const postInfo = `Edited by u/${username} on ${editDateTimeUTC} UTC. Mod label ${showModLabel ? '' : 'not '}shown. ${stickyPost ? 'Stickied' : 'Not stickied'}. ${lockPost ? 'Locked' : 'Not locked'}.\n\nPost body:\n\n${text}`;

    let newVersion = 2;
    while (true) {
      const newPostInfo = await redis.get(`bot-post-info-${post.id}-version-${newVersion}-v${DBVersion()}`);
      if (newPostInfo) { newVersion++; }
      else { break; }
    }
    await redis.set(`bot-post-info-${post.id}-version-${newVersion}-v${DBVersion()}`, postInfo);
    console.log(`${getDateTime()}: u/${username} edited bot post: ${post.id}`);
    return c.json<UiResponse>({ showToast: `You successfully edited the bot post!` }, 200);
  } catch (error) {
    console.error(`${getDateTime()}: Error editing bot post: ${error}`);
    return c.json<UiResponse>({ showToast: `Error editing bot post: ${error}` }, 500);
  }
});

forms.post('/view-bot-post-info', async (c) => {
  console.log(`${getDateTime()}: Received request to view bot post info.`);
  const values = await c.req.json<{postId: string, version: string}>();
  const postId = values.postId;
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to view bot post info.', }, 200); }
  let post;
  try { post = await reddit.getPostById(postId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  if (post.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'The provided post ID does not correspond to a post made by the bot. Please try again.',}, 200); }
  if (!(await redis.get(`bot-post-info-${post.id}-version-1-v${DBVersion()}`))) { return c.json<UiResponse>({ showToast: 'This post was not made by a moderator as the bot, so there is no information to view.',}, 200); }
  const version = values.version;
  console.log(`${getDateTime()}: u/${username} is viewing bot post info for post: ${post.id}, version: '${version}'`);
  console.log(`${getDateTime()}: summary? ${version === 'summary'}. full? ${version === 'full'}. specific version? ${!isNaN(parseInt(version))}`);
  let postInfo: string;
  if (version == 'full' || version == 'summary') {
    postInfo = `You are viewing the ${version=='full' ? 'full history' : 'history summary'} of [this](https://www.reddit.com/r/${context.subredditName}/comments/${post.id}) bot post:`;
    let versionNumber = 1;
    while (true) {
      const newPostInfo = await redis.get(`bot-post-info-${post.id}-version-${versionNumber}-v${DBVersion()}`);
      if (newPostInfo) {
        postInfo += `\n\n# Version ${versionNumber}:`;
        if (version == 'full') { postInfo += `\n\n${newPostInfo}`; }
        else { postInfo += `\n\n${newPostInfo.split('\n\n')[0]}`; }
      }
      else { break; }
      versionNumber++;
    }
  }
  else {
    const postInfoData = await redis.get(`bot-post-info-${post.id}-version-${version}-v${DBVersion()}`);
    if (!postInfoData) { return c.json<UiResponse>({ showToast: 'The specified version of this bot post does not exist. Please try again.',}, 200); }
    postInfo = `You are viewing version ${version} of [this](https://www.reddit.com/r/${context.subredditName}/comments/${post.id}) bot post:`;
    postInfo += `\n\n${postInfoData}`;
  }
  await reddit.sendPrivateMessage({to: username, subject: `Bot post info for post ${post.id.slice(3)}`, text: postInfo});
  console.log(`${getDateTime()}: u/${username} viewed bot post info for post: ${post.id}`);
  return c.json<UiResponse>({ showToast: `You successfully viewed the bot post info! It has been sent to your private messages.` }, 200);
});

forms.post('/comment-as-bot', async (c) => {
  console.log(`${getDateTime()}: Received request to comment as bot.`);
  const values = await c.req.json<{targetId: string, body: string, showModLabel: boolean, stickyComment?: boolean, lockComment: boolean, footerChoice: string, customFooter: string}>();
  const targetId = values.targetId;
  const text = values.body;
  const showModLabel = values.showModLabel;
  let stickyComment = values.stickyComment;
  const lockComment = values.lockComment;
  const footerChoice = values.footerChoice;
  const customFooter = values.customFooter;
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to post as the bot.', }, 200); }
  if (targetId == undefined || text == undefined || showModLabel == undefined || lockComment == undefined || footerChoice == undefined) { return c.json<UiResponse>({ showToast: 'Missing required fields. Please try again.',}, 200); }
  if (footerChoice == 'custom' && customFooter == undefined) { return c.json<UiResponse>({ showToast: 'Missing custom footer text. Please try again.',}, 200); }
  if (footerChoice != 'custom' && customFooter != undefined) { return c.json<UiResponse>({ showToast: 'Custom footer text provided but footer choice is not set to custom. Please try again.',}, 200); }
  let footerText: string;
  if (footerChoice == 'custom') { footerText = `\n\n^(${customFooter})`; }
  else if (footerChoice == 'bot') { footerText = await botExplainer(); }
  else if (footerChoice == 'mod') { footerText = `\n\n^(This piece of content has been created manually by a moderator.)`; }
  else { return c.json<UiResponse>({ showToast: 'Invalid footer choice. Please try again.',}, 200); }
  const isPost = targetId.startsWith('t3_');
  const isComment = targetId.startsWith('t1_');
  if (!isPost && !isComment) { return c.json<UiResponse>({ showToast: 'Invalid target ID. Please try again.',}, 200); }
  let target;
  try { target = isPost ? await reddit.getPostById(targetId as T3) : await reddit.getCommentById(targetId as T1); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid target ID. Please try again.',}, 200); }
  if (target.subredditName != context.subredditName) { return c.json<UiResponse>({ showToast: 'The target post or comment is not in the correct subreddit. Please try again.',}, 200); }
  if (isComment && stickyComment) { return c.json<UiResponse>({ showToast: 'You cannot sticky a comment below another comment. Please try again.',}, 200); }
  if (stickyComment && !showModLabel) { return c.json<UiResponse>({ showToast: 'You cannot sticky a comment without showing the mod label. Please try again.',}, 200); }
  if (stickyComment === undefined) { stickyComment = false; }

  try {
    const comment = await reddit.submitComment({id: isPost ? targetId as T3 : targetId as T1, text: text + footerText, runAs: 'APP'});
    if (showModLabel) { await comment.distinguish(stickyComment); }
    if (lockComment) { await comment.lock(); }
    const commentDateTimeUTC = comment.createdAt.toISOString();
    const commentInfo = `Commented by u/${username} on ${commentDateTimeUTC} UTC. Mod label ${showModLabel ? '' : 'not '}shown. ${stickyComment ? 'Stickied' : 'Not stickied'}. ${lockComment ? 'Locked' : 'Not locked'}.\n\nComment body:\n\n${text + footerText}`;
    await redis.set(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`, commentInfo);
    console.log(`${getDateTime()}: u/${username} commented as bot: ${comment.id}`);
    return c.json<UiResponse>({ showToast: `You successfully commented as the bot!` }, 200);
  } catch (error) {
    console.error(`${getDateTime()}: Error commenting as bot: ${error}`);
    return c.json<UiResponse>({ showToast: `Error commenting as bot: ${error}` }, 500);
  }
});

forms.post('/edit-bot-comment', async (c) => {
  console.log(`${getDateTime()}: Received request to edit a bot comment.`);
  const values = await c.req.json<{commentId: string, body: string, showModLabel: boolean, stickyComment?: boolean, lockComment: boolean}>();
  const commentId = values.commentId;
  let comment;
  try { comment = await reddit.getCommentById(commentId as T1); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid comment ID provided. Please try again.',}, 200); }
  if (comment.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'The provided comment ID does not correspond to a comment made by the bot. Please try again.',}, 200); }
  if (!(await redis.get(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`))) { return c.json<UiResponse>({ showToast: 'This comment was not made by a moderator as the bot, so it cannot be edited.',}, 200); }
  const text = values.body;
  const showModLabel = values.showModLabel;
  let stickyComment = values.stickyComment;
  const lockComment = values.lockComment;
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to edit a bot comment.', }, 200); }
  if (text == undefined || showModLabel == undefined || lockComment == undefined) { return c.json<UiResponse>({ showToast: 'Missing required fields. Please try again.',}, 200); }
  const commentOnPost = comment.parentId.startsWith('t3_');
  if (!commentOnPost && stickyComment) { return c.json<UiResponse>({ showToast: 'You cannot sticky a comment below another comment. Please try again.',}, 200); }
  if (stickyComment && !showModLabel) { return c.json<UiResponse>({ showToast: 'You cannot sticky a comment without showing the mod label. Please try again.',}, 200); }
  if (stickyComment === undefined) { stickyComment = false; }

  try {
    await comment.edit({text: text});
    if (showModLabel) { await comment.distinguish(stickyComment); }
    else { await comment.undistinguish(); }
    if (lockComment) { await comment.lock(); }
    else { await comment.unlock(); }
    const editDateTimeUTC = new Date().toISOString();
    const commentInfo = `Edited by u/${username} on ${editDateTimeUTC} UTC. Mod label ${showModLabel ? '' : 'not '}shown. ${stickyComment ? 'Stickied' : 'Not stickied'}. ${lockComment ? 'Locked' : 'Not locked'}.\n\nComment body:\n\n${text}`;

    let newVersion = 2;
    while (true) {
      const newCommentInfo = await redis.get(`bot-comment-info-${comment.id}-version-${newVersion}-v${DBVersion()}`);
      if (newCommentInfo) { newVersion++; }
      else { break; }
    }
    await redis.set(`bot-comment-info-${comment.id}-version-${newVersion}-v${DBVersion()}`, commentInfo);
    console.log(`${getDateTime()}: u/${username} edited bot comment: ${comment.id}`);
    return c.json<UiResponse>({ showToast: `You successfully edited the bot comment!` }, 200);
  } catch (error) {
    console.error(`${getDateTime()}: Error editing bot comment: ${error}`);
    return c.json<UiResponse>({ showToast: `Error editing bot comment: ${error}` }, 500);
  }
});

forms.post('/view-bot-comment-info', async (c) => {
  console.log(`${getDateTime()}: Received request to view bot comment info.`);
  const values = await c.req.json<{commentId: string, version: string}>();
  const commentId = values.commentId;
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to view bot comment info.', }, 200); }
  let comment;
  try { comment = await reddit.getCommentById(commentId as T1); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid comment ID provided. Please try again.',}, 200); }
  if (comment.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'The provided comment ID does not correspond to a comment made by the bot. Please try again.',}, 200); }
  if (!(await redis.get(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`))) { return c.json<UiResponse>({ showToast: 'This comment was not made by a moderator as the bot, so there is no information to view.',}, 200); }
  const version = values.version;
  console.log(`${getDateTime()}: u/${username} is viewing bot comment info for comment: ${comment.id}, version: '${version}'`);
  console.log(`${getDateTime()}: summary? ${version === 'summary'}. full? ${version === 'full'}. specific version? ${!isNaN(parseInt(version))}`);
  let commentInfo: string;
  if (version == 'full' || version == 'summary') {
    commentInfo = `You are viewing the ${version=='full' ? 'full history' : 'history summary'} of [this](https://www.reddit.com${comment.permalink}) bot comment:`;
    let versionNumber = 1;
    while (true) {
      const newCommentInfo = await redis.get(`bot-comment-info-${comment.id}-version-${versionNumber}-v${DBVersion()}`);
      if (newCommentInfo) {
        commentInfo += `\n\n# Version ${versionNumber}:`;
        if (version == 'full') { commentInfo += `\n\n${newCommentInfo}`; }
        else { commentInfo += `\n\n${newCommentInfo.split('\n\n')[0]}`; }
      }
      else { break; }
      versionNumber++;
    }
  }
  else {
    const commentInfoData = await redis.get(`bot-comment-info-${comment.id}-version-${version}-v${DBVersion()}`);
    if (!commentInfoData) { return c.json<UiResponse>({ showToast: 'The specified version of this bot comment does not exist. Please try again.',}, 200); }
    commentInfo = `You are viewing version ${version} of [this](https://www.reddit.com${comment.permalink}) bot comment:`;
    commentInfo += `\n\n${commentInfoData}`;
  }
  await reddit.sendPrivateMessage({to: username, subject: `Bot comment info for comment ${comment.id.slice(3)}`, text: commentInfo});
  console.log(`${getDateTime()}: u/${username} viewed bot comment info for comment: ${comment.id}`);
  return c.json<UiResponse>({ showToast: `You successfully viewed the bot comment info! It has been sent to your private messages.` }, 200);
});

forms.post('/change-settings', async (c) => {
  console.log(`${getDateTime()}: Received request to change settings.`);
  const values = await c.req.json<{multiplePostsPerDayReasonId: string, wrongTitleReasonId: string, selfieRemovalReasonId: string, selfieFlairId: string, politicalFlairId: string}>();
  const multiplePostsPerDayReasonId = Array.isArray(values.multiplePostsPerDayReasonId) ? values.multiplePostsPerDayReasonId[0] : values.multiplePostsPerDayReasonId;
  const wrongTitleReasonId = Array.isArray(values.wrongTitleReasonId) ? values.wrongTitleReasonId[0] : values.wrongTitleReasonId;
  const selfieRemovalReasonId = Array.isArray(values.selfieRemovalReasonId) ? values.selfieRemovalReasonId[0] : values.selfieRemovalReasonId;
  const selfieFlairId = Array.isArray(values.selfieFlairId) ? values.selfieFlairId[0] : values.selfieFlairId;
  const politicalFlairId = Array.isArray(values.politicalFlairId) ? values.politicalFlairId[0] : values.politicalFlairId;
  if (!multiplePostsPerDayReasonId || !wrongTitleReasonId || !selfieRemovalReasonId || !selfieFlairId || !politicalFlairId) { return c.json<UiResponse>({ showToast: 'Missing required fields. Please try again.',}, 200); }
  const subreddit = await reddit.getCurrentSubreddit();

  const removalReasons = await subreddit.getRemovalReasons();
  removalReasons.push({ id: 'none', title: 'None', message: 'None' });
  const rawFlairs = await subreddit.getPostFlairTemplates();
  const flairs: { label: string, value: string }[] = [];
  for (const flair of rawFlairs) { flairs.push({ value: flair.id, label: flair.text }); }
  flairs.push({ value: 'none', label: 'None' });

  if (!removalReasons.some(reason => reason.id == multiplePostsPerDayReasonId)) { return c.json<UiResponse>({ showToast: 'Invalid removal reason ID for multiple posts per day. Please try again.',}, 200); }
  if (!removalReasons.some(reason => reason.id == wrongTitleReasonId)) { return c.json<UiResponse>({ showToast: 'Invalid removal reason ID for wrong title. Please try again.',}, 200); }
  if (!removalReasons.some(reason => reason.id == selfieRemovalReasonId)) { return c.json<UiResponse>({ showToast: 'Invalid removal reason ID for selfie rule. Please try again.',}, 200); }
  if (!flairs.some(flair => flair.value == selfieFlairId)) { return c.json<UiResponse>({ showToast: 'Invalid flair ID for selfie. Please try again.',}, 200); }
  if (!flairs.some(flair => flair.value == politicalFlairId)) { return c.json<UiResponse>({ showToast: 'Invalid flair ID for political. Please try again.',}, 200); }

  if (multiplePostsPerDayReasonId == 'none') { await redis.del(`multiple-posts-per-day-removal-reason-id-v${await DBVersion()}`); }
  else { await redis.set(`multiple-posts-per-day-removal-reason-id-v${await DBVersion()}`, multiplePostsPerDayReasonId); }  
  if (wrongTitleReasonId == 'none') { await redis.del(`wrong-title-removal-reason-id-v${await DBVersion()}`); }
  else { await redis.set(`wrong-title-removal-reason-id-v${await DBVersion()}`, wrongTitleReasonId); }
  if (selfieRemovalReasonId == 'none') { await redis.del(`selfie-removal-reason-id-v${await DBVersion()}`); }
  else { await redis.set(`selfie-removal-reason-id-v${await DBVersion()}`, selfieRemovalReasonId); }
  if (selfieFlairId == 'none') { await redis.del(`selfie-flair-id-v${await DBVersion()}`); }
  else { await redis.set(`selfie-flair-id-v${await DBVersion()}`, selfieFlairId); }
  if (politicalFlairId == 'none') { await redis.del(`political-flair-id-v${await DBVersion()}`); }
  else { await redis.set(`political-flair-id-v${await DBVersion()}`, politicalFlairId); }

  if (multiplePostsPerDayReasonId != 'none' && wrongTitleReasonId != 'none' && selfieRemovalReasonId != 'none' && selfieFlairId != 'none' && politicalFlairId != 'none') { await redis.del(`last-notification-time-missing-setting-v${await DBVersion()}`); }

  console.log(`${getDateTime()}: Settings updated: multiplePostsPerDayReasonId=${multiplePostsPerDayReasonId}, wrongTitleReasonId=${wrongTitleReasonId}, selfieRemovalReasonId=${selfieRemovalReasonId}, selfieFlairId=${selfieFlairId}, politicalFlairId=${politicalFlairId}`);
  return c.json<UiResponse>({ showToast: 'Settings updated successfully.' }, 200);
});

forms.post('/apply-rule', async (c) => {
  console.log(`${getDateTime()}: Received request to apply a rule to a post.`);
  const values = await c.req.json<{postId: string, rule: string}>();
  const postId = `t3_${values.postId}`;
  const rule = values.rule;
  let post;
  try { post = await reddit.getPostById(postId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  if (post.subredditName != context.subredditName) { return c.json<UiResponse>({ showToast: 'The provided post ID is not in the correct subreddit. Please try again.',}, 200); }

  if (rule != 'selfie' && rule != 'political') { return c.json<UiResponse>({ showToast: 'Invalid rule provided. Please try again.',}, 200); }

  const modUsername = await reddit.getCurrentUsername();
  if (modUsername == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to apply a rule.', }, 200); }
  if (rule == 'selfie') {
    const modNoteText = 'Had to be reminded of selfie rules.';
    const timestamp = post.createdAt.getTime();
    let isWeekend = false;
    for (const timeZone of Intl.supportedValuesOf('timeZone')) {
      const date = new Date(timestamp);
      const dayOfWeek = date.toLocaleString('en-US', { timeZone: timeZone, weekday: 'long' });
      if (dayOfWeek == 'Friday' || dayOfWeek == 'Saturday' || dayOfWeek == 'Sunday') {
        isWeekend = true;
        break;
      }
    }

    if (!isWeekend) {
      await removePost(postId as T3, 'This post has been removed because selfies may only be posted on friday, saturday, or sunday.', 'selfie');
      return c.json<UiResponse>({ showToast: 'The selfie wasn\'t posted on a friday, saturday, or sunday. The post has been removed.',}, 200);
    }

    const selfieFlairId = await redis.get(`selfie-flair-id-v${await DBVersion()}`);
    if (!selfieFlairId) {
      await remindModsAboutMissingSettings(`The bot tried to apply a selfie flair to a post but was unable to find the correct flair. Consider adding flairs to the bot settings. This can be done by going to the bot settings in the subreddit menu and selecting the appropriate flairs.`, 'Missing flair');
      return c.json<UiResponse>({ showToast: 'Selfie flair ID is not set. Please set it in the settings first.',}, 200);
    }
    const flair = post.flair;
    const isSelfieFlair = flair?.templateId == selfieFlairId;
    const isSpoiled = post.isSpoiler();

    if (!isSelfieFlair) { await reddit.setPostFlair({subredditName: context.subredditName, postId: postId as T3, flairTemplateId: selfieFlairId}); }
    if (!isSpoiled) { await post.markAsSpoiler(); }

    if (!isSelfieFlair || !isSpoiled) {
      const modNotes = await reddit.getModNotes({subreddit: context.subredditName, user: post.authorName, filter: 'NOTE'}).all();
      let nReminders = 0;
      for await (const note of modNotes) { if (note.userNote?.note == modNoteText) { nReminders++; } }
      let nAllowedReminders = await settings.get('nAllowedSelfieRuleBreaks');
      if (typeof nAllowedReminders != 'number') { nAllowedReminders = 2; }      
      if (nReminders >= nAllowedReminders) {
        await removePost(postId as T3, 'This post didn\'t have the selfie flair and/or was not marked as a spoiler. This has happened ' + nAllowedReminders + ' or more times in the past as well with your posts, therefore this post was removed.', 'selfie');
        return c.json<UiResponse>({ showToast: 'This user broke selfie rules ' + nAllowedReminders + ' or more times in the past, so their post was removed.',}, 200);
      }

      const commentText = 'This post didn\'t have the selfie flair and/or was not marked as a spoiler. I now gave it the correct flair and marked it as a spoiler. Please be sure to follow the selfie rules in the future.'+await botExplainer();
      const comment = await post.addComment({text: commentText, runAs: 'APP'});
      await comment.distinguish(true);

      const commentDateTimeUTC = comment.createdAt.toISOString();
      const commentInfo = `u/${modUsername} used the 'apply rule' feature on ${commentDateTimeUTC} UTC, which created this comment.\n\nComment body:\n\n${commentText}`;
      await redis.set(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`, commentInfo);
 
      await post.approve();
      await reddit.addModNote({subreddit: context.subredditName, user: post.authorName, note: modNoteText});
      return c.json<UiResponse>({ showToast: 'The post has been flaired as a selfie and marked as a spoiler.',}, 200);
    }
    await post.approve();
    return c.json<UiResponse>({ showToast: 'The post already follows all selfie rules I can check.',}, 200);
  }
  if (rule == 'political') {
    const modNoteText = 'Had to be reminded of political posts rules.';

    const politicalFlairId = await redis.get(`political-flair-id-v${await DBVersion()}`);
    if (!politicalFlairId) {
      await remindModsAboutMissingSettings(`The bot tried to apply a political flair to a post but was unable to find the correct flair. Consider adding flairs to the bot settings. This can be done by going to the bot settings in the subreddit menu and selecting the appropriate flairs.`, 'Missing flair');
      return c.json<UiResponse>({ showToast: 'Political flair ID is not set. Please set it in the settings first.',}, 200);
    }
    const flair = post.flair;
    const isPoliticalFlair = flair?.templateId == politicalFlairId;
    const isSpoiled = post.isSpoiler();

    if (!isPoliticalFlair) { await reddit.setPostFlair({subredditName: context.subredditName, postId: postId as T3, flairTemplateId: politicalFlairId}); }
    if (!isSpoiled) { await post.markAsSpoiler(); }

    if (!isPoliticalFlair || !isSpoiled) {
      const modNotes = await reddit.getModNotes({subreddit: context.subredditName, user: post.authorName, filter: 'NOTE'}).all();
      let nReminders = 0;
      for await (const note of modNotes) { if (note.userNote?.note == modNoteText) { nReminders++; } }
      let nAllowedReminders = await settings.get('nAllowedPoliticalRuleBreaks');
      if (typeof nAllowedReminders != 'number') { nAllowedReminders = 4; }
      if (nReminders >= nAllowedReminders) {
        await removePost(postId as T3, 'This post didn\'t have the political flair and/or was not marked as a spoiler. This has happened ' + nAllowedReminders + ' or more times in the past as well with your posts, therefore this post was removed.', 'political');
        return c.json<UiResponse>({ showToast: 'This user broke political rules ' + nAllowedReminders + ' or more times in the past, so their post was removed.',}, 200);
      }

      const commentText = 'This post didn\'t have the political flair and/or was not marked as a spoiler. I now gave it the correct flair and marked it as a spoiler. Please be sure to follow the political rules in the future.'+await botExplainer();
      const comment = await post.addComment({text: commentText, runAs: 'APP'});
      await comment.distinguish(true);

      const commentDateTimeUTC = comment.createdAt.toISOString();
      const commentInfo = `u/${modUsername} used the 'apply rule' feature on ${commentDateTimeUTC} UTC, which created this comment.\n\nComment body:\n\n${commentText}`;
      await redis.set(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`, commentInfo);

      await post.approve();
      await reddit.addModNote({subreddit: context.subredditName, user: post.authorName, note: modNoteText});
      return c.json<UiResponse>({ showToast: 'The post has been flaired as a political and marked as a spoiler.',}, 200);
    }
    await post.approve();
    return c.json<UiResponse>({ showToast: 'The post already follows all political rules I can check.',}, 200);
  }
  return c.json<UiResponse>({ showToast: 'Invalid rule provided. Please try again.',}, 200);
});
  
forms.post('/fix-streak-followup', async (c) => {
  console.log(`${getDateTime()}: Received request to fix streak followup.`);
  const values = await c.req.json<{postId: string, method: string}>();
  const postId = `t3_${values.postId}`;
  const method = values.method;
  let post;
  try { post = await reddit.getPostById(postId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  if (post.subredditName != context.subredditName) { return c.json<UiResponse>({ showToast: 'The provided post ID is not in the correct subreddit. Please try again.',}, 200); }

  if (method == 'add') {
    console.log(`${getDateTime()}: Received request to add a post to the streak database.`);
    const dbVersion = await DBVersion();
    const alreadyInDatabase = await redis.zScore(`posts-v${dbVersion}`, postId as T3) != undefined;
    if (alreadyInDatabase) { return c.json<UiResponse>({ showToast: 'The provided post ID is already in the streak database. Please try again.',}, 200); }  
    const postNumber = parseInt(post.title);
    if (isNaN(postNumber)) { return c.json<UiResponse>({ showToast: 'The provided post ID does not correspond to a valid counting post. Please try again.',}, 200); }
    const authorName = post.authorName;
    const timestamp = post.createdAt.getTime();

    await redis.zRem(`early-deleted-post-queue-v${dbVersion}`, [postId as T3]);
    await redis.zRem(`late-deleted-post-queue-v${dbVersion}`, [postId as T3]);
    await redis.zRem(`early-deleted-posts-v${dbVersion}`, [postId as T3]);

    await addPostToDatabase(postId as T3, postNumber, authorName, timestamp);

    console.log(`${getDateTime()}: Manually added post ${postId} to the streak database (post number: ${postNumber}, author: ${authorName}, timestamp: ${timestamp}).`);
    return c.json<UiResponse>({ showToast: `Added post ${postId} to the streak database.` }, 200);
  }
  if (method == 'remove') {
    console.log(`${getDateTime()}: Received request to remove a post from the streak database.`);
    const dbVersion = await DBVersion();
    const alreadyInDatabase = await redis.zScore(`posts-v${dbVersion}`, postId as T3) != undefined;
    if (!alreadyInDatabase) { return c.json<UiResponse>({ showToast: 'The provided post ID is not in the streak database. Please try again.',}, 200); }
    await removePostFromDatabase(postId as T3, true);
    console.log(`${getDateTime()}: Manually removed post ${postId} from the streak database.`);
    return c.json<UiResponse>({ showToast: `Removed post ${postId} from the streak database.` }, 200);
  }
  if (method == 'manual') {
    return c.json<UiResponse>({
      showForm: {
        name: 'addManualStreak',
        form: {
          fields: [{
            name: 'streak',
            label: 'Streak Length',
            type: 'number',
            helpText: 'Enter the length of the streak you want to add.'
          },
          {
            name: 'postId',
            label: 'Post ID',
            type: 'string',
            defaultValue: postId.slice(3),
            helpText: 'This is the ID of the post for which you want to add the streak to the database (this can be a post in the current subreddit or one in r/CountOnceADay).'
          }],
          title: 'Add a manual streak',
          description: 'This form allows you to add a manual streak for a user. This is mainly useful for if a user moves from r/CountOnceADay to the current subreddit and you want to add their streak to the database. In that case put the post ID of their last post in r/CountOnceADay and the length of their streak.',
          acceptLabel: 'Add manual streak',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
  }
  return c.json<UiResponse>({ showToast: 'Invalid method provided. Please try again.',}, 200);
});

forms.post('/fix-streak', async (c) => {
  console.log(`${getDateTime()}: Received request to fix streak.`);
  const values = await c.req.json<{postId: string, receivedStreakReport: boolean}>();
  const postId = `t3_${values.postId}`;
  let post;
  try { post = await reddit.getPostById(postId as T3); }
  catch (e) { return c.json<UiResponse>({ showToast: 'Invalid post ID provided. Please try again.',}, 200); }
  if (post.subredditName != context.subredditName) { return c.json<UiResponse>({ showToast: 'The provided post ID is not in the correct subreddit. Please try again.',}, 200); }
  const username = post.authorName;
  const receivedStreakReport = values.receivedStreakReport;
  if (!receivedStreakReport) {
    const timezones = Intl.supportedValuesOf('timeZone')
    return c.json<UiResponse>({
      showForm: {
        name: 'viewStreakDevelopment',
        form: {
          fields: [{
            name: 'username',
            label: 'Username',
            type: 'string',
            defaultValue: username,
            helpText: 'This is the name of the user for whom you want to view streak development.',
            required: true
          },
          {
            name: 'timeZone',
            label: 'Time Zone',
            type: 'select',
            options: timezones.map((tz) => ({ value: tz, label: tz })),
            defaultValue: ['Europe/Amsterdam'],
            required: true,
            helpText: 'This is the time zone in which you want to view the streak development.'
          }],
          title: 'View streak development',
          description: 'This will send a report to mod mail with the streak development of the user. Please read it and then come back to this form to complete the process.',
          acceptLabel: 'View streak development',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
  }
  if (receivedStreakReport) {
    return c.json<UiResponse>({
      showForm: {
        name: 'fixStreakFollowup',
        form: {
          fields: [{
            name: 'method',
            label: 'Method',
            type: 'select',
            options: [
              { value: 'add', label: 'Add post to streak database' },
              { value: 'remove', label: 'Remove post from streak database' },
              { value: 'manual', label: 'Add manual streak to database' }
          ],
            helpText: 'Select the method you want to use to fix the streak. Look at the mod mail report to see which method is appropriate. If you are unsure, ask u/Aartvb.',
            required: true
          },
          {
            name: 'postId',
            label: 'Post ID',
            type: 'string',
            defaultValue: postId.slice(3),
            helpText: 'This is the ID of the post for which you want to fix the streak.',
            required: true
          }],
          title: 'Fix a user\'s streak',
          description: 'This form allows you to fix the streak of a user. This is useful if a user complains about their streak.',
          acceptLabel: 'Fix streak',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
  }
});

forms.post('/view-streak-development', async (c) => {
  const values = await c.req.json<{username: string, timeZone: string}>();
  const username = values.username;
  const timezone = values.timeZone;
  const success = await reportStreakDevelopment(username, timezone);
  if (!success) {
    return c.json<UiResponse>({ showToast: 'Failed to send streak development report to mod mail.',}, 200);
  }
  return c.json<UiResponse>({ showToast: 'Streak development report sent to mod mail. Read it and then come back to this form.',}, 200);
});

forms.post('/change-notification-subscription', async (c) => { 
  const values = await c.req.json<{subscribe: boolean}>();
  const username = await reddit.getCurrentUsername();
  if (username == undefined) { return c.json<UiResponse>({ showToast: 'You must be logged in to change your notification subscription.', }, 200); }
  if (values.subscribe) { await addSubscription(username); }
  if (!values.subscribe) { await removeSubscription(username); }
  return c.json<UiResponse>({ showToast: 'Subscription status updated.' }, 200);
});