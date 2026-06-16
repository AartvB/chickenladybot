import { redis } from '@devvit/redis';
import { T3 } from '@devvit/shared-types/tid.js';
import { reddit } from '@devvit/web/server';
import { Post } from '@devvit/web/server';

export async function readList(redisList: string): Promise<{member: string, score: number}[]> {
  // FIXME: Check if this works:
  // - Modify the list while reading it
  // - Test with more than 1000 items in the list, to ensure it correctly reads all items

  let list = await redis.zRange(redisList, 0, 999);
  let found_full_list = list.length < 1000;
  while (!found_full_list) {
    let list_loop = await redis.zRange(redisList, list.length, list.length + 999);
    list = list.concat(list_loop);
    if (list_loop.length < 1000) { found_full_list = true; }
  }
  return list;
}

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

  const target_post_id = await redis.get('current-count-post-id');
  if (target_post_id == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }
  let target_post = await reddit.getPostById(target_post_id as T3);
  const current_count_string = await redis.get('current-count');
  const current_count = parseInt(current_count_string || '0');
  const subreddit_name = await redis.get('subredditname');
  if (subreddit_name == undefined) { return { status: 'error', message: 'Database error', number: 404 }; }

  const text = `The next number should be: [${current_count + 1}](https://www.reddit.com/r/${subreddit_name}/submit?title=${current_count + 1})` + await botExplainer();
  await target_post.edit({ text: text });

  return { status: 'ok', message: `Successfully processed new posts`, number: 200 }
}