import { botExplainer } from './helpers';
import { context, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/shared-types/tid.js';
import { redis } from '@devvit/redis';

async function updateTargetPost() {
  // Update the post that tells the user what the correct next number is.

  const target_post_id = await redis.get('current-count-post-id');
  if (target_post_id == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
  let target_post = await reddit.getPostById(target_post_id as T3);
  const current_count_string = await redis.get('current-count');
  const current_count = parseInt(current_count_string || '0');
  const subreddit_name = await redis.get('subredditname');
  if (subreddit_name == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }

  const text = `The next number should be: [${current_count + 1}](https://www.reddit.com/r/${subreddit_name}/submit?title=${current_count + 1})` + botExplainer();
  await target_post.edit({ text: text });

  return { status: 'ok', message: `Successfully processed new posts`, number: 200 }
}

async function addPostToDatabase(postId: T3, postNumber: number, authorName: string, timestamp: number) {
  const maxPost = (await redis.zRange('posts', -1, -1))[0];
  const maxPostScore = maxPost?.score ?? 0;

  await redis.set('current-count', postNumber.toString());
  await redis.zAdd('posts', { member: postId, score: maxPostScore+1 });
  await redis.zAdd(`posts-of-${authorName}`, { member: postId, score: maxPostScore+1 });
  await redis.set(`post-info-${postId}`, JSON.stringify({ 'authorName': authorName, 'timestamp': timestamp }));

  // Only adds to the end of the streak-queue
  const maxStreak = (await redis.zRange('streak-queue', -1, -1))[0];
  const maxStreakScore = maxStreak?.score ?? 0;

  await redis.zAdd('streak-queue', { member: postId, score: maxStreakScore+1 })
}

async function removePost(postId: T3, commentText: string) {
  await reddit.remove(postId, false);
  const postInfo = await reddit.getPostById(postId);
  let message = commentText;

  let streak = (await redis.zScore('current-streaks', postInfo.authorName)) ?? 0;
  if (streak >= 4 && postInfo.createdAt.getTime() < Date.now() - 4 * 60000) { message += '\n\nTechnical issues caused the bot to remove this post much later than normal. We try our best to keep things running smoothly, but sometimes the system runs into issues. Note, this does not count as your post for the day, feel free to post again.\n\nIf this causes you to miss a day and your streak was reset due to the late removal, feel free to reach out to the mods [here](https://www.reddit.com/message/compose/?to=/r/countwithchickenlady) and we can reinstate it.'; }
  message += await botExplainer();

  await reddit.submitComment({id: postId, text: message, runAs: 'APP'});
}

export async function handleNewPosts(): Promise<{ status: string; message: string; number: number }> {
  // TODO: Add extra disclaimer to removal reason if the delay between removal and the post being created is more than 2 minutes, to avoid confusion in case of a delay by reddit in removing the post
  const startTime = Date.now();
  while (await redis.zCard('new_post_queue') > 0) {
    const startTimeCurrentPost = Date.now();
    const postInfo = (await redis.zRange('new_post_queue', -1, -1))[0];
    if (postInfo == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
    const postId = postInfo['member'];

    const post = await reddit.getPostById(postId as T3);

    if (post.authorName == '[deleted]' || post.removed) { // TODO: Add to to delete list?
      await redis.zRem('new_post_queue', [postId]);
      continue;
    }

    const postTitle = post.title;
    if (/^\d+$/.test(postTitle)) {
      const postNumber = parseInt(postTitle);
      const currentCountString = await redis.get('current-count');
      if (currentCountString == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
      const currentCount = parseInt(currentCountString);

      if (postNumber == currentCount + 1 || currentCount == 0) {
        if (!post.approved) {

          // Check if the user has posted twice on the same calendar day in the last 3 days
          let postDateTimes = [[postId, post.createdAt.getTime()]];

          let earlierPosts = (await redis.zRange(`posts-of-${post.authorName}`, -20, -1)).reverse();
          for (const postInfo of earlierPosts) {
            const earlierPostId = postInfo['member'];
            const earlierPost = await reddit.getPostById(earlierPostId as T3);
            if ((earlierPost.authorName == '[deleted]' || earlierPost.removed) && earlierPost.createdAt.getTime() > Date.now() - 10 * 60000) { continue; } // Post was removed within 10 minutes ago, ignore it - FIXME: ADD TO TO DELETE LIST
            // TODO: Remove magic number 10 in line above
            // FIXME: can we directly look if it was removed within 10 minutes?
            postDateTimes.push([earlierPostId, earlierPost.createdAt.getTime()]);
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
              commentText += `${days} days, ${hours} hours, ${minutes} minutes and ${seconds} seconds ago: [${earlierPost.title}](https://www.reddit.com/${earlierPost.permalink})\n\n`;            
            }
            await removePost(postId as T3, commentText);
          }
          else { await addPostToDatabase(postId as T3, postNumber, post.authorName, post.createdAt.getTime()); }
        }
      }
      else if (!post.approved) {
        const currentCountLink = await redis.get('current-count-link');
        if (currentCountLink == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
        const commentText = `This post has been removed because the correct next number was ${currentCount + 1}, but this post has '${postNumber}' as title. Please check the most recent number before posting. You can find the correct number in [this](${currentCountLink}) post.\n\nIt might be possible that someone else simply was slightly faster with their post.\n\nFeel free to post again with the correct new number.`;

        await removePost(postId as T3, commentText);
      }
      else { await addPostToDatabase(postId as T3, Math.max(postNumber, currentCount), post.authorName, post.createdAt.getTime()); }
    }
    else if (!post.approved) {
      // Leave a comment explaining the removal
      const currentCountLink = await redis.get('current-count-link');
      if (currentCountLink == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
      const commentText = `This post has been removed because the title must be a number. Please only post the next number in sequence. You can find the correct number in [this](${currentCountLink}) post.`;

      await removePost(postId as T3, commentText);
    }
    else {} // Valid post detected

    await redis.zRem('new_post_queue', [postId]);
    const processingTime = Date.now() - startTimeCurrentPost;
    const timeLeft = 30000 - (Date.now() - startTime);
    if (timeLeft < processingTime * 1.5 || timeLeft < 10000) {
      break; // Stop processing more posts if we are running out of time, to ensure we finish before the time-out of 30 seconds.
    }
  }
  const result = updateTargetPost();
  return result;
}

export async function detectNewPosts(): Promise<{ message: string; status: string; number: number }> {
  // FIXME: set variable below to 5 or 10
  // FIXME: Check if the latest checked post was posted earlier than the most recent post, to make sure there are not more simultaneous new posts
  const nSubsequentChecks = 0; // Number of extra subsequent existing posts to check when finding an existing post
  let limit_str = await redis.get('new-post-limit');
  if (limit_str == undefined) {
    limit_str = '10';
  }
  let limit = parseInt(limit_str); // Number of posts to check in each batch

  const subreddit = await reddit.getSubredditInfoById(context.subredditId);
  if (subreddit.name == undefined) {
    return { status: 'error', message: 'Subreddit not found', number: 404 };
  }

  while (true) {
    const posts = await reddit.getNewPosts({
      subredditName: subreddit.name,
      limit: limit
    });
    
    let nExtraPostsToDo = nSubsequentChecks;
    let newPostIds: T3[] = [];
    for await (const post of posts) {
      let score = await redis.zScore('posts', post.id);
      if (score == undefined) {
        newPostIds.push(post.id);
        nExtraPostsToDo = nSubsequentChecks;
      }
      else {
        if (nExtraPostsToDo > 0) { nExtraPostsToDo--;}
        else { break; }
      }
    }
    if (nExtraPostsToDo > 0) { // Try again with more posts if we haven't found enough existing posts to be confident we've found all new posts
      limit *= 2;
      await redis.set('new-post-limit', limit.toString());
    }

    else {
      await redis.set('new-post-limit', '10'); // Reset limit to 10 for next check, since we successfully found all new posts with the current limit
      for (const [index, postId] of newPostIds.entries()) {
        const postTitle = (await reddit.getPostById(postId)).title;
        await redis.zAdd('new_post_queue', { member: postId, score: index });
      }
      return { status: 'ok', message: `Added ${newPostIds.length} new posts to the queue`, number: 200 };
    }
  }
}