import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { reddit } from '@devvit/web/server';
import { Post } from '@devvit/web/server';

export async function botExplainer(): Promise<string> { return "\n\n^(This comment is automatically updated by a bot. If you think it made a mistake, [contact the mods](https://www.reddit.com/message/compose/?to=/r/countwithchickenlady) via modmail. The code for this bot is fully open source, and can be found [here](https://github.com/AartvB/ChickenBotOnceADay).)"; }
// FIXME: Above: add the correct link

export async function isPostDeleted(post: Post): Promise<boolean> { return post.authorName == '[deleted]' || post.removed; }

export async function addToEndOfQueue(queueName: string, text: string): Promise<number> {
  const maxValue = (await redis.zRange(queueName, -1, -1))[0];
  const maxScore = maxValue?.score ?? 0;
  await redis.zAdd(queueName, { member: text, score: maxScore+1 });
  return maxScore+1;
}

export async function updateTargetPost() {
  // Update the post that tells the user what the correct next number is.

  const targetPostId = await redis.get('current-count-post-id');
  if (targetPostId == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
  let targetPost = await reddit.getPostById(targetPostId as T3);
  const currentCountString = await redis.get('current-count');
  const currentCount = parseInt(currentCountString || '0');
  const subredditName = await redis.get('subredditname');
  if (subredditName == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }

  const text = `The next number should be: [${currentCount + 1}](https://www.reddit.com/r/${subredditName}/submit?title=${currentCount + 1})` + await botExplainer();
  await targetPost.edit({ text: text });

  return { status: 'ok', message: `Successfully processed new posts`, number: 200 }
}