import { redis } from '@devvit/redis';

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