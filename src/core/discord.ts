import { context, reddit, redis, settings } from "@devvit/web/server";
import { DBVersion, getDateTime, isInSoftShutdown, isPostDeleted, TaskScheduler } from "./helpers";
import { T3 } from "@devvit/web/shared";

export async function handleDiscord(): Promise<{ message: string; status: string; number: number }> {
  if (context.subredditName != 'countwithchickenlady') { return { message: "This task can only be run in the countwithchickenlady subreddit.", status: "error" , number: 500 }; }
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
  if (await taskScheduler.endTask()) { if (!await isInSoftShutdown()) { return { status: 'error', message: 'Discord task stopped due to time limit', number: 503 }; } else { return { status: 'ok', message: 'Discord task stopped due to shutdown', number: 200 }; } }

  // Devvit scheduler task payload
  const botToken = await settings.get("discordBotToken");
  const newPostChannelId = await settings.get("discordNewPostChannelId");

  if (!botToken || !newPostChannelId) { return { message: "Missing Discord bot token or channel ID.", status: "error" , number: 500 }; }
  if (typeof botToken !== "string" || typeof newPostChannelId !== "string") { return { message: "Invalid Discord bot token or channel ID.", status: "error" , number: 500 }; }
  
  const dbVersion = await DBVersion();

  // Task: posting new posts to discord
  console.log(`${getDateTime()}: Checking for new posts to post to discord.`);
  const posts = await redis.zRange(`posts-v${dbVersion}`, -100, -1);
  posts.sort((a, b) => (a.score - b.score));

  for await (const post of posts) {
    if (post.score >= Date.now() - 5 * 60 * 1000) { break; } // Stop if the post is newer than 5 minutes

    const postInfo = await redis.get(`post-info-${post.member}-v${dbVersion}`);
    if (!postInfo) { continue; }
    const postInfoObj = JSON.parse(postInfo);
    if ('discordMessageId' in postInfoObj) { // If it doesn't have this key, it's the old version, and the old bot handled the discord message
      if (postInfoObj.discordMessageId) { continue; } // If it has a discord link, it has already been sent to discord
      const postId = post.member.slice(3);
      let authorName = postInfoObj.authorName;
      authorName = authorName.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/~/g, '\\~'); // Escape markdown characters
      const response = await fetch(`https://discord.com/api/v10/channels/${newPostChannelId}/messages`, {method: "POST",
        headers: {
          "Authorization": `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: `{"content":"u/${authorName} has counted to [${postInfoObj.postNumber}](https://www.reddit.com/r/${context.subredditName}/comments/${postId}/)."}`
      })
      if (!response.ok) {throw new Error(`Discord webhook failed: HTTP ${response.status}`); }

      const isNSFW = (await reddit.getPostById(post.member as T3)).isNsfw();
      const discordMessageId = (await response.json()).id;
      await redis.set(`post-info-${post.member}-v${dbVersion}`, JSON.stringify({ ...postInfoObj, discordMessageId: discordMessageId, isNSFW: isNSFW }));
      console.log(`${getDateTime()}: Posted new post ${post.member} to discord with message ID ${discordMessageId}.`);
    }
  }

  const successString = "Posting recent posts to discord has succeeded.";

  // Task: Reporting posted image of the day to discord
  const dailyBotPostChannelId = await settings.get("discordDailyBotPostChannelId");
  if (!dailyBotPostChannelId || typeof dailyBotPostChannelId !== "string") { return { message: successString + " Missing Discord daily bot post channel ID.", status: "error" , number: 500 }; }

  const latestPostId = await redis.get(`latest-bot-post-v${dbVersion}`);
  const latestBotPostDiscordMessageId = await redis.get(`latest-bot-post-discord-message-v${dbVersion}`);
  let latestPostTimestamp = 0;
  if (latestPostId) {
    const latestPost = await reddit.getPostById(latestPostId as T3);
    latestPostTimestamp = latestPost.createdAt.getTime();

    if (latestBotPostDiscordMessageId != latestPostId && Date.now() - latestPostTimestamp > 60 * 1000) { // If the latest post is less than a minute old, don't post it to discord yet
      if (await isPostDeleted(latestPost)) {
        if (latestBotPostDiscordMessageId) {
          latestPostTimestamp = (await reddit.getPostById(latestBotPostDiscordMessageId as T3)).createdAt.getTime(); // If the latest post is deleted, use the previous post's timestamp instead
        }
        else { latestPostTimestamp = 0; } // If there is no previous post, set the timestamp to 0 so that the bot will post the next image of the day
      }
      else {
        const latestChosenDiscordMessageId = await redis.get(`latest-chosen-discord-message-id-v${dbVersion}`);
        if (!latestChosenDiscordMessageId) { return { message: successString + " Missing latest chosen discord message ID.", status: "error" , number: 500 }; }

        const response = await fetch(`https://discord.com/api/v10/channels/${dailyBotPostChannelId}/messages/${latestChosenDiscordMessageId}`, { headers: { Authorization: `Bot ${botToken}`, }, });
        let body: string;
        if (!response.ok) { body = JSON.stringify({ content: `I posted todays image, decided on by your votes! You can find it here in post [${latestPost.title}](https://www.reddit.com/r/${context.subredditName}/comments/${latestPost.id.slice(3)}/). Post one or more images below if you want your image to be posted by me tomorrow!"` }); }
        else {
            body = JSON.stringify({
              content: `This is the image I will post today, decided on by your votes! You can find it here in post [${latestPost.title}](https://www.reddit.com/r/${context.subredditName}/comments/${latestPost.id.slice(3)}/). Post one or more images below if you want your image to be posted by me tomorrow!"`,
              message_reference: { message_id: latestChosenDiscordMessageId, },
            });
        }
        const replyResponse = await fetch(`https://discord.com/api/v10/channels/${dailyBotPostChannelId}/messages`, {
          method: "POST",
          headers: {
            "Authorization": `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: body,
        });
        if (!replyResponse.ok) { return { message: successString + " Failed to reply to the latest chosen discord message.", status: "error" , number: 500 }; }
        await redis.set(`latest-bot-post-discord-message-v${dbVersion}`, latestPost.id);
        await redis.set(`latest-bot-discord-message-v${dbVersion}`, (await replyResponse.json()).id);
        console.log(`${getDateTime()}: Posted link to image of the day to discord.`);
      }
    }
  }

  // Task: Posting image of the day from discord to reddit
  if (Date.now() - latestPostTimestamp >= 24 * 60 * 60 * 1000 + 60 * 1000) {
    let link = `https://discord.com/api/v10/channels/${dailyBotPostChannelId}/messages`;
    let latestDiscordId = await redis.get(`latest-bot-discord-message-v${dbVersion}`);
    if (latestDiscordId) { link += `?after=${latestDiscordId}&limit=100`; }
    else { link += `?limit=100`; }

    console.log(`${getDateTime()}: Checking for the latest image of the day from discord to post to reddit.`);

    const response = await fetch(link, { headers: { Authorization: `Bot ${botToken}`, }, });
    const messages = await response.json();
    if (!Array.isArray(messages)) { return { message: successString + " Failed to fetch messages from Discord.", status: "error" , number: 500 }; }

    let checkmarkCounts: { messageId: string; count: number; timestamp: number; }[] = [];
    for (const message of messages) {
      const reactions = Array.isArray(message.reactions) ? message.reactions : [];
      const checkmarkReaction = reactions.find((reaction: any) => reaction.emoji?.name === '✅');
      const checkmarkCount = checkmarkReaction ? checkmarkReaction.count : 0;
      checkmarkCounts.push({ messageId: message.id, count: checkmarkCount, timestamp: message.timestamp });
    }
    // Get image with highest checkmark or earliest if tied
    checkmarkCounts.sort((a, b) => b.count - a.count || new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const topMessage = checkmarkCounts[0];
    if (topMessage === undefined || topMessage.count === 0) { return { message: successString + " No messages with checkmark reactions found in Discord channel.", status: "ok" , number: 200 }; }

    const topAttachment = messages.find((msg: any) => msg.id === topMessage.messageId)?.attachments?.[0];
    if (!topAttachment) { return { message: successString + " Top message has no attachment.", status: "ok" , number: 200 }; }

    let nextNumber = await redis.get(`current-count-v${dbVersion}`) ?? '0';
    nextNumber = (parseInt(nextNumber) + 1).toString();

    const post = await reddit.submitPost( {subredditName: context.subredditName, title: nextNumber, url: topAttachment.url,} );
    const comment = await reddit.submitComment({id: post.id, text: "This image was chosen by the people in our discord server. Want to have a vote on this? Join us [here](https://discord.gg/tefj2Xu9FP)!", runAs: 'APP'});
    comment.distinguish(true);
    await redis.set(`latest-bot-post-v${dbVersion}`, post.id);
    await redis.set(`latest-chosen-discord-message-id-v${dbVersion}`, topMessage.messageId);
    console.log(`${getDateTime()}: Posted image of the day from discord to reddit with post ID ${post.id} and title ${nextNumber}.`);
  }

  return { message: successString + " Discord messages sent successfully.", status: "ok" , number: 200};
}

export async function handleDiscordNSFWCheck(): Promise<boolean> {
  if (context.subredditName != 'countwithchickenlady') { return true; }
  const taskScheduler = new TaskScheduler({ stopAtSoftShutdown: true });
  if (await taskScheduler.endTask()) { return false; }

	// Devvit scheduler task payload
  const botToken = await settings.get("discordBotToken");
  const newPostChannelId = await settings.get("discordNewPostChannelId");

  if (!botToken || !newPostChannelId || typeof botToken !== "string" || typeof newPostChannelId !== "string") { return false; }
  
  const dbVersion = await DBVersion();

	const now = Date.now();
	const startPostScore = now - 21 * 24 * 60 * 60 * 1000; // Start 21 days ago

  let currentTask = parseInt(await redis.get(`background-task-tracker-v${dbVersion}`) ?? `${startPostScore}`);
  if (isNaN(currentTask)) { currentTask = startPostScore; }

	console.log(`${getDateTime()}: Starting checking for nsfw posts on the discord, starting from score ${currentTask}`);

	while (true) {
		if (!await taskScheduler.startNextTask()) { return false; }

    currentTask = parseInt(await redis.get(`background-task-tracker-v${dbVersion}`) ?? `${startPostScore}`);
		const postToCheck = (await redis.zRange(`posts-v${dbVersion}`, currentTask, 'inf', { by: 'score' }))[0];

    if (postToCheck == undefined) {	break; }
    const nextTask = postToCheck.score + 1;

		const postId = postToCheck['member'];
		const postInfo = await redis.get(`post-info-${postId}-v${dbVersion}`);
		if (!postInfo) { await redis.set(`background-task-tracker-v${dbVersion}`, nextTask.toString()); continue; }

		const postInfoObj = JSON.parse(postInfo);
		if (!('discordMessageId' in postInfoObj)) { await redis.set(`background-task-tracker-v${dbVersion}`, nextTask.toString()); continue; }

		const post = await reddit.getPostById(postId as T3);

		if (post.isNsfw() && !postInfoObj.isNSFW) {
      console.log(`${getDateTime()}: Post ${postId} is NSFW now, updating discord message.`);
			const messageUrl = `https://discord.com/api/v10/channels/${newPostChannelId}/messages/${postInfoObj.discordMessageId}`;;
			const getResponse = await fetch(messageUrl, {headers: { Authorization: `Bot ${botToken}`,},});

			if (!getResponse.ok) { await redis.set(`background-task-tracker-v${dbVersion}`, nextTask.toString()); continue; }

			const message = await getResponse.json();
			if (!message.embeds || message.embeds.length === 0) { await redis.set(`background-task-tracker-v${dbVersion}`, nextTask.toString()); continue; }

			const embed = message.embeds[0];

			embed.title = `[Mature Content] ${embed.title ?? ""}`.slice(0, 256);
			embed.thumbnail = { url: "https://i.redd.it/o0h58lzmax6a1.png", };

			const editResponse = await fetch(messageUrl, {
				method: "PATCH",
				headers: {
					Authorization: `Bot ${botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ embeds: message.embeds, }),
			});

      if (!editResponse.ok) { await redis.set(`background-task-tracker-v${dbVersion}`, nextTask.toString()); continue; }

			await redis.set(`post-info-${postId}-v${dbVersion}`, JSON.stringify({ ...postInfoObj, isNSFW: true }));
		}
    await redis.set(`background-task-tracker-v${dbVersion}`, nextTask.toString());
	}
	return true;
}