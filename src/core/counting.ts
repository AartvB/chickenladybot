import { botExplainer, isPostDeleted, addToEndOfQueue, updateTargetPost, DBVersion, isPostDeletedEarly, TaskScheduler, getDateTime, isInSoftShutdown } from './helpers';
import { context, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/shared-types/tid.js';
import { redis } from '@devvit/redis';

export async function addPostToDatabase(postId: T3, postNumber: number, authorName: string, timestamp: number) {
  console.log(`${getDateTime()}: Adding post ${postId} with title ${postNumber} by user ${authorName} to the database`);
  const dbVersion = await DBVersion();
  const dateUTC = new Date(timestamp).toISOString().slice(0, 10);
  const currentCount = await redis.get(`current-count-v${dbVersion}`);
  if (currentCount == undefined) { return; }
  await redis.set(`current-count-v${dbVersion}`, Math.max(postNumber, parseInt(currentCount)).toString());
  await redis.zAdd(`posts-v${dbVersion}`, {member: postId, score: timestamp });
  await redis.zAdd(`posts-of-${authorName}-v${dbVersion}`, { member: postId, score: timestamp });
  await redis.set(`post-info-${postId}-v${dbVersion}`, JSON.stringify({ 'authorName': authorName, 'postNumber': postNumber.toString(), 'date': dateUTC }));
  await redis.zAdd(`posts-per-user-v${dbVersion}`, { member: authorName, score: await redis.zCard(`posts-of-${authorName}-v${dbVersion}`) });

	let nZeroes = 1;
  while (true) {
		const zeroesString = '0'.repeat(nZeroes);
    if (postNumber.toString().endsWith(zeroesString)) {
      await redis.zAdd(`whole-count-1${zeroesString}-posts-v${dbVersion}`, { member: postId, score: postNumber });
      const currentUserCount = await redis.zScore(`whole-count-1${zeroesString}-users-v${dbVersion}`, authorName) ?? 0;
      await redis.zAdd(`whole-count-1${zeroesString}-users-v${dbVersion}`, { member: authorName, score: currentUserCount + 1 });
      nZeroes += 1;
    }
    else { break; }
  }

  if (/^(\d)\1*$/.test(postNumber.toString())) {
    await redis.zAdd(`identical-digits-posts-v${dbVersion}`, { member: postId, score: postNumber });
    const currentUserCount = await redis.zScore(`identical-digits-users-v${dbVersion}`, authorName) ?? 0;
    await redis.zAdd(`identical-digits-users-v${dbVersion}`, { member: authorName, score: currentUserCount + 1 });
  }

  if (postNumber.toString() == postNumber.toString().split('').reverse().join('')) {
    await redis.zAdd(`palindrome-posts-v${dbVersion}`, { member: postId, score: postNumber });
    const currentUserCount = await redis.zScore(`palindrome-users-v${dbVersion}`, authorName) ?? 0;
    await redis.zAdd(`palindrome-users-v${dbVersion}`, { member: authorName, score: currentUserCount + 1 });
  }

  if (await redis.zScore(`users-v${dbVersion}`, authorName) == undefined) { await addToEndOfQueue(`users-v${dbVersion}`, authorName); }
  await addToEndOfQueue(`streak-queue-v${dbVersion}`, postId);
}

export async function addRecentPostsToDatabase(nPosts: number = 1000): Promise<boolean> {
  const subreddit = await reddit.getSubredditInfoById(context.subredditId);
  if (subreddit.name == undefined) {
    return false;
  }
  const recentPosts = await reddit.getNewPosts({ subredditName: subreddit.name, limit: nPosts });
  for await (const post of recentPosts) {
    if (/^\d+$/.test(post.title)) {
      await addPostToDatabase(post.id as T3, parseInt(post.title), post.authorName, post.createdAt.getTime());
    }
  }
  return true
}

async function removePost(postId: T3, commentText: string) {
  console.log(`${getDateTime()}: Removing post ${postId}`);
  const postInfo = await reddit.getPostById(postId);
  let message = commentText;

  const streak = (await redis.zScore(`current-streaks-v${await DBVersion()}`, postInfo.authorName)) ?? 0;
  if (streak >= 4 && postInfo.createdAt.getTime() < Date.now() - 4 * 60000) { message += '\n\nTechnical issues caused the bot to remove this post much later than normal. We try our best to keep things running smoothly, but sometimes the system runs into issues. Note, this does not count as your post for the day, feel free to post again.\n\nIf this causes you to miss a day and your streak was reset due to the late removal, feel free to reach out to the mods [here](https://www.reddit.com/message/compose/?to=/r/countwithchickenlady) and we can reinstate it.'; }
  message += await botExplainer();

  await reddit.submitComment({id: postId, text: message, runAs: 'APP'});
  await reddit.remove(postId, false);
}

export async function handleNewPosts(): Promise<{ status: string; message: string; number: number }> {
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
  if (await taskScheduler.endTask()) { if (!await isInSoftShutdown()) { return { status: 'error', message: 'Background task stopped due to time limit', number: 503 }; } else { return { status: 'ok', message: 'Background task stopped due to shutdown', number: 200 }; } }
  const dbVersion = await DBVersion();
  while (await redis.zCard(`new-post-queue-v${dbVersion}`) > 0 && await taskScheduler.startNextTask()) {
    const postInfo = (await redis.zRange(`new-post-queue-v${dbVersion}`, -1, -1))[0];
    if (postInfo == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
    const postId = postInfo['member'];

    const post = await reddit.getPostById(postId as T3);

    if (await isPostDeleted(post)) { await redis.zRem(`new-post-queue-v${dbVersion}`, [postId]); continue; }

    const postTitle = post.title;
    console.log(`${getDateTime()}: Processing new post ${postId} with title '${postTitle}' by user ${post.authorName}`);
    if (/^\d+$/.test(postTitle)) {
      const postNumber = parseInt(postTitle);
      const currentCountString = await redis.get(`current-count-v${dbVersion}`);
      if (currentCountString == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
      const currentCount = parseInt(currentCountString);

      if (post.approved) { await addPostToDatabase(postId as T3, postNumber, post.authorName, post.createdAt.getTime()); }
      else if (postNumber == currentCount + 1 || currentCount == 0) {
        // Check if the user has posted twice on the same calendar day in the last 3 days
        const postDateTimes = [[postId, post.createdAt.getTime()]];

        const earlierPosts = (await redis.zRange(`posts-of-${post.authorName}-v${dbVersion}`, -20, -1)).reverse();
        for (const postInfo of earlierPosts) {
          const earlierPostId = postInfo['member'];
          if (await isPostDeletedEarly(earlierPostId as T3)) { continue; }
          postDateTimes.push([earlierPostId, postInfo['score']]);
          if (postDateTimes.length == 3) { break; } // Only use the two most recent posts
        }

        let postedOnDifferentCalanderDays = false;
        for (const timeZone of Intl.supportedValuesOf('timeZone')) {
          const dateFormatter = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});

          const localDates = postDateTimes.map((dateTime) => dateFormatter.format(new Date(dateTime[1] as number)));

          if (new Set(localDates).size == localDates.length) {
            postedOnDifferentCalanderDays = true;
            break;
          }
        }

        if (!postedOnDifferentCalanderDays) {
          let commentText = "This post has been removed because of your latest two or three posts, at least two have been on the same calendar day. You may post only once per calendar day. Please wait until the next calendar day to post again.\nThe posts were as follows:\n\n";
          const now = Date.now();

          for (const postDateTime of postDateTimes) {
            const past = postDateTime[1] as number;
            const diff = now - past;
            const days = Math.floor(diff / 86400 / 1000); // 86400 seconds in a day, 1000 milliseconds in a second
            const hours = Math.floor((diff % (86400 * 1000)) / (3600 * 1000));
            const minutes = Math.floor((diff % (3600 * 1000)) / (60 * 1000));
            const seconds = Math.floor((diff % (60 * 1000)) / 1000);

            const earlierPost = await reddit.getPostById(postDateTime[0] as T3);
            commentText += `${days} days, ${hours} hours, ${minutes} minutes and ${seconds} seconds ago: [${earlierPost.title}](https://www.reddit.com/${earlierPost.permalink})`;
            if (postDateTime[0] == postId) { commentText += " (this post)"; }
            commentText += "\n\n";
          }
          await removePost(postId as T3, commentText);
        }
        else { await addPostToDatabase(postId as T3, postNumber, post.authorName, post.createdAt.getTime()); }
      }
      else {
        const currentCountLink = `https://www.reddit.com/r/${context.subredditName}/comments/${await redis.get(`current-count-post-id-v${dbVersion}`)}/`;
        const commentText = `This post has been removed because the correct next number was ${currentCount + 1}, but this post has '${postNumber}' as title. Please check the most recent number before posting. You can find the correct number in [this](${currentCountLink}) post.\n\nIt might be possible that someone else simply was slightly faster with their post.\n\nFeel free to post again with the correct new number.`;

        await removePost(postId as T3, commentText);
      }
    }
    else if (!post.approved) {
      // Leave a comment explaining the removal
      const currentCountLink = `https://www.reddit.com/r/${context.subredditName}/comments/${await redis.get(`current-count-post-id-v${dbVersion}`)}/`;
      if (currentCountLink == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
      const commentText = `This post has been removed because the title must be a number. Please only post the next number in sequence. You can find the correct number in [this](${currentCountLink}) post.`;

      await removePost(postId as T3, commentText);
    }
    // Otherwise a valid post detected, but not added to the database since it's not a number

    await redis.zRem(`new-post-queue-v${dbVersion}`, [postId]);
  }
  const result = await updateTargetPost();
  return result;
}

export async function detectNewPosts(): Promise<{ message: string; status: string; number: number }> {
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
  if (await taskScheduler.endTask()) { if (!await isInSoftShutdown()) { return { status: 'error', message: 'Background task stopped due to time limit', number: 503 }; } else { return { status: 'ok', message: 'Background task stopped due to shutdown', number: 200 }; } }
  const dbVersion = await DBVersion();
  const nSubsequentChecks = 5; // Number of extra subsequent existing posts to check when finding an existing post
  let limitStr = await redis.get(`new-post-limit-v${dbVersion}`);
  if (limitStr == undefined) {
    limitStr = '10';
  }
  let limit = parseInt(limitStr); // Number of posts to check in each batch

  const subreddit = await reddit.getSubredditInfoById(context.subredditId);
  if (subreddit.name == undefined) {
    return { status: 'error', message: 'Subreddit not found', number: 404 };
  }

  while (await taskScheduler.startNextTask()) {
    const posts = await reddit.getNewPosts({ subredditName: subreddit.name, limit: limit });
    
    let nExtraPostsToDo = nSubsequentChecks;
    const newPostIds: T3[] = [];
    for await (const post of posts) {
      const score = await redis.zScore(`posts-v${dbVersion}`, post.id);
      if (score == undefined) {
        newPostIds.push(post.id);
        nExtraPostsToDo = nSubsequentChecks;
      }
      else {
        if (nExtraPostsToDo > 0) { nExtraPostsToDo--;}
        else { break; }
      }
    }
    if (nExtraPostsToDo > 0 && limit < 1000) { // Try again with more posts if we haven't found enough existing posts to be confident we've found all new posts, but stop when the limit is 1000 since that is the maximum number of posts we can get from the API
      limit *= 2;
      await redis.set(`new-post-limit-v${dbVersion}`, limit.toString());
    }
    else {
      await redis.set(`new-post-limit-v${dbVersion}`, '10'); // Reset limit to 10 for next check, since we successfully found all new posts with the current limit
      for (const [index, postId] of newPostIds.entries()) {
        console.log(`${getDateTime()}: New post detected: ${postId}`);
        await redis.zAdd(`new-post-queue-v${dbVersion}`, { member: postId, score: index });
      }
      return { status: 'ok', message: `Added ${newPostIds.length} new posts to the queue`, number: 200 };
    }
  }
  if (!await isInSoftShutdown()) { return { message: 'Background task stopped due to time limit', status: 'error', number: 503 }; } else { return { message: 'Background task stopped due to shutdown', status: 'ok', number: 200 }; }
}