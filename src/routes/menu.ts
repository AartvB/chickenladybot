import { Hono } from 'hono';
import type { T1, T3, UiResponse } from '@devvit/web/shared';
import { addToEndOfQueue, DBVersion, formatDateTime, isInHardShutdown, isInSoftShutdown } from '../core/helpers';
import { reddit, redis } from '@devvit/web/server';

export const menu = new Hono();

menu.post('/toggle-shutdown', async (c) => {
  // A form that allows a moderator to shutdown the bot in case it goes haywire, or restore it to normal services
  if (await isInHardShutdown()) {
    return c.json<UiResponse>({
      showForm: {
        name: 'deactivateHardShutdown',
        form: {
          fields: [{
            name: 'softShutdown',
            label: 'Go to soft shutdown',
            type: 'boolean',
            defaultValue: false,
            helpText: 'Go to a soft shutdown mode. If you leave this box unchecked, the bot will return to normal operation.',
          }],
          title: 'Confirm ending hard shutdown mode',
          description: 'The chickenladybot is currently in hard shutdown mode. This means that all bot operations are suspended and it will not process any new posts. You can toggle this mode off to resume normal operation.',
          acceptLabel: 'End hard shutdown mode',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
  }
  else if (await isInSoftShutdown()) {
    return c.json<UiResponse>({
      showForm: {
        name: 'handleSoftShutdown',
        form: {
          fields: [{
            name: 'shutdownChoice',
            label: 'Action',
            type: 'select',
            options: [
              { label: 'End shutdown mode', value: 'end' },
              { label: 'Go into hard shutdown (do not do this unless you understand the consequences)', value: 'hard' },
            ]
          }],
          title: 'Move from soft shutdown mode',
          description: 'The chickenladybot is currently in (soft) shutdown mode. This means that it will not process any new posts and the explainer post is disabled. You can toggle this mode off to resume normal operation, or go into hard shutdown.',
          acceptLabel: 'Confirm',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
  }
  else {
    return c.json<UiResponse>({
      showForm: {
        name: 'activateShutdown',
        form: {
          fields: [{
            name: 'hardShutdown',
            label: 'Hard shutdown',
            type: 'boolean',
            defaultValue: false,
            helpText: 'Only use a hard shutdown in extreme cases, such as a database update, since it will shut down all essential background processes. If you want the bot to stop handling any new posts, a normal (soft) shutdown is enough. If you are unsure, leave this unchecked.',
          }],
          title: 'Shutdown the bot',
          description: 'The chickenladybot is currently running normally. If you shutdown the bot, it will no longer process any new posts and the explainer post will be disabled.',
          acceptLabel: 'Shutdown the chickenladybot',
          cancelLabel: 'Cancel'
        },
      },
    }, 200);
  }
});

menu.post('/fix-streak', async (c) => {
  // A form that allows a moderator to fix a streak of a user
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId;
  if (postId == undefined) { return c.json<UiResponse>({ showToast: 'Post info not found',}, 200); }
  return c.json<UiResponse>({
    showForm: {
      name: 'fixStreak',
      form: {
        fields: [{
          name: 'receivedStreakReport',
          label: 'Received streak report',
          type: 'boolean',
          helpText: 'Did you already receive a report about this user\'s streak in mod mail?',
          defaultValue: false
        },
        {
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          helpText: 'The ID of the post that you want to fix the streak for (the relevant ID is filled in automatically).',
          defaultValue: postId.slice(3),
          required: true
        }],
        title: 'Fix a user\'s streak',
        description: 'This form allows you to fix the streak of a user. This is useful if a user complains about their streak.',
        acceptLabel: 'Fix streak',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/post-as-bot', async (c) => {
  // Allows a mod to make a post as the bot
  return c.json<UiResponse>({
    showForm: {
      name: 'postAsBot',
      form: {
        fields: [{
          name: 'title',
          label: 'Post Title',
          type: 'string',
          helpText: 'This is the title of the post you want to make as the bot.',
          required: true
        },
        {
          name: 'body',
          label: 'Post Body',
          type: 'paragraph',
          helpText: 'This is the body of the post you want to make as the bot.',
          required: true
        },
        {
          name: 'showModLabel',
          label: 'Show Mod Label',
          type: 'boolean',
          defaultValue: true,
          helpText: 'If checked, the mod label appears on the post.'
        },
        {
          name: 'stickyPost',
          label: 'Sticky Post',
          type: 'boolean',
          defaultValue: false,
          helpText: 'If checked, the post will be stickied to the top of the subreddit.'
        },
        {
          name: 'lockPost',
          label: 'Lock Post',
          type: 'boolean',
          defaultValue: false,
          helpText: 'If checked, the post will be locked and no comments can be made below it.'
        },
        {
          name: 'footerChoice',
          label: 'Post Footer',
          type: 'select',
          options: [
            { label: 'Talk as mod team', value: 'mod' },
            { label: 'Pretend to be the bot (mostly as a joke)', value: 'bot' },
            { label: 'Custom: fill line below', value: 'custom' },
          ],
          defaultValue: ['mod'],
          helpText: 'Choose how the post should be closed. If you choose "Custom", fill in the line below.'
        },
        {
          name: 'customFooter',
          label: 'Custom Footer',
          type: 'string',
          helpText: 'If you selected "Custom" in the previous field, fill in the footer line here. Otherwise leave this empty.',
        }],
        title: 'Make a post as the bot',
        description: 'This form allows you to make a post as the bot. This is useful if you want to make an announcement. Note that moderators can always see who made the post.',
        acceptLabel: 'Make post as bot',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/edit-bot-post', async (c) => {
  // Allows a mod to edit a bot post
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId?.slice(3) ?? '';
  const post = await reddit.getPostById(postId as T3);
  if (post == undefined) { return c.json<UiResponse>({ showToast: 'Post not found',}, 200); }
  if (post.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'This post was not made by the bot',}, 200); }
  if (!(await redis.get(`bot-post-info-${post.id}-version-1-v${DBVersion()}`))) { return c.json<UiResponse>({ showToast: 'This post was not made by a moderator as the bot, so it cannot be edited.',}, 200); }

  return c.json<UiResponse>({
    showForm: {
      name: 'editBotPost',
      form: {
        fields: [{
          name: 'body',
          label: 'Post Body',
          type: 'paragraph',
          helpText: 'This is the body of the bot post you want to edit.',
          required: true,
          defaultValue: post.body
        },
        {
          name: 'showModLabel',
          label: 'Show Mod Label',
          type: 'boolean',
          defaultValue: post.distinguishedBy == 'moderator',
          helpText: 'If checked, the mod label appears on the post.'
        },
        {
          name: 'stickyPost',
          label: 'Sticky Post',
          type: 'boolean',
          defaultValue: post.isStickied(),
          helpText: 'If checked, the post will be stickied to the top of the subreddit.'
        },
        {
          name: 'lockPost',
          label: 'Lock Post',
          type: 'boolean',
          defaultValue: post.isLocked(),
          helpText: 'If checked, the post will be locked and no comments can be made below it.'
        },
        {
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post you want to edit (the relevant ID is filled in automatically).',
          required: true
        }],
        title: 'Edit this bot post',
        description: 'This form allows you to edit a post that was made by a moderator as the bot. Note that moderators can always see who made and edited the post.',
        acceptLabel: 'Edit bot post',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/view-bot-post-info', async (c) => {
  // Allows a mod to view the info of a bot post
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId?.slice(3) ?? '';
  const post = await reddit.getPostById(postId as T3);
  if (post == undefined) { return c.json<UiResponse>({ showToast: 'Post not found',}, 200); }
  if (post.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'This post was not made by the bot',}, 200); }
  const postInfo = await redis.get(`bot-post-info-${post.id}-version-1-v${DBVersion()}`);
  if (!postInfo) { return c.json<UiResponse>({ showToast: 'This post was created by the bot itself.',}, 200); }

  let versions: {label: string, value: string}[] = [{ label: 'History summary', value: 'summary' }, { label: 'Full history', value: 'full' }];
  let version = 1;
  while (true) {
    const info = await redis.get(`bot-post-info-${post.id}-version-${version}-v${DBVersion()}`);
    if (info) {
      versions.push({ label: `Version ${version}`, value: `${version}` });
      version++;
    }
    else { break; }
  }
  if (versions.length == 0) { return c.json<UiResponse>({ showToast: 'No versions of this post were found.',}, 200); }

  return c.json<UiResponse>({
    showForm: {
      name: 'viewBotPostInfo',
      form: {
        fields: [{
          name: 'version',
          label: 'Version',
          type: 'select',
          options: versions.map((v) => ({ label: v.label, value: v.value })),
          defaultValue: ['summary'],
          helpText: 'Select the version of the post info you want to view.'
        },
        {
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post you want to view info for (the relevant ID is filled in automatically).',
          required: true
        }],
        title: 'View bot post info',
        description: 'View the version history of a bot post: which moderators made which changes at which point in time? It gets sent to you in a private message.',
        acceptLabel: 'Send post info in a private message',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/comment-as-bot', async (c) => {
  // Allows a mod to make a comment as the bot
  const values = await c.req.json<{targetId?: string}>();
  const isPost = values.targetId?.startsWith('t3_') ?? false;
  const isComment = values.targetId?.startsWith('t1_') ?? false;
  if (!isPost && !isComment) { return c.json<UiResponse>({ showToast: 'Invalid target ID. Please try again.',}, 200); }
  let fields: any[] = [{
      name: 'body',
      label: 'Comment Text',
      type: 'paragraph',
      helpText: 'This is the text of the comment you want to make as the bot.',
      required: true
    },
    {
      name: 'showModLabel',
      label: 'Show Mod Label',
      type: 'boolean',
      defaultValue: true,
      helpText: 'If checked, the mod label appears on the comment.'
    }]
  if (isPost) {
    fields.push({
      name: 'stickyComment',
      label: 'Sticky Comment',
      type: 'boolean',
      defaultValue: false,
      helpText: 'If checked, the comment will be stickied to the top of the post. Can only be done if the mod label is shown.'
    })
  }
  fields.push({
    name: 'lockComment',
    label: 'Lock Comment',
    type: 'boolean',
    defaultValue: false,
    helpText: 'If checked, the comment will be locked and no comments can be made below it.'
  },
  {
    name: 'footerChoice',
    label: 'Comment Footer',
    type: 'select',
    options: [
      { label: 'Talk as mod team', value: 'mod' },
      { label: 'Pretend to be the bot (mostly as a joke)', value: 'bot' },
      { label: 'Custom: fill line below', value: 'custom' },
    ],
    defaultValue: ['mod'],
    helpText: 'Choose how the comment should be closed. If you choose "Custom", fill in the line below.'
  },
  {
    name: 'customFooter',
    label: 'Custom Footer',
    type: 'string',
    helpText: 'If you selected "Custom" in the previous field, fill in the footer line here. Otherwise leave this empty.',
  },
  {
    name: 'targetId',
    label: 'Response To (Post or Comment) ID',
    type: 'string',
    defaultValue: values.targetId,
    helpText: 'This is the ID of the post or comment you want to respond to as the bot (the relevant ID is filled in automatically).',
    required: true
  });

  return c.json<UiResponse>({
    showForm: {
      name: 'commentAsBot',
      form: {
        fields: fields,
        title: 'Make a comment as the bot',
        description: 'This form allows you to make a comment as the bot. This is useful if you want to talk on behalf of the mod team instead of as yourself. Note that moderators can always see who made the comment.',
        acceptLabel: 'Make comment as bot',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/edit-bot-comment', async (c) => {
  // Allows a mod to edit a bot comment
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId?.slice(3) ?? '';
  const comment = await reddit.getCommentById(postId as T1);
  if (comment == undefined) { return c.json<UiResponse>({ showToast: 'Comment not found',}, 200); }
  if (comment.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'This comment was not made by the bot',}, 200); }
  if (!(await redis.get(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`))) { return c.json<UiResponse>({ showToast: 'This comment was not made by a moderator as the bot, so it cannot be edited.',}, 200); }

  const commentOnPost = comment.parentId.startsWith('t3_');

  let fields: any[] = [
    {
      name: 'body',
      label: 'Comment Text',
      type: 'paragraph',
      helpText: 'This is the text of the comment you want to edit.',
      required: true,
      defaultValue: comment.body
    },
    {
      name: 'showModLabel',
      label: 'Show Mod Label',
      type: 'boolean',
      defaultValue: comment.distinguishedBy == 'moderator',
      helpText: 'If checked, the mod label appears on the comment.'
    }
  ]

  if (commentOnPost) {
    fields.push({
      name: 'stickyComment',
      label: 'Sticky Comment',
      type: 'boolean',
      defaultValue: comment.isStickied(),
      helpText: 'If checked, the comment will be stickied to the top of the post. Can only be done if the mod label is shown.'
    })
  }
  fields.push({
    name: 'lockComment',
    label: 'Lock Comment',
    type: 'boolean',
    defaultValue: comment.isLocked(),
    helpText: 'If checked, the comment will be locked and no comments can be made below it.'
  },
  {
    name: 'commentId',
    label: 'Comment ID',
    type: 'string',
    defaultValue: values.targetId,
    helpText: 'This is the ID of the comment you want to edit (the relevant ID is filled in automatically).',
    required: true
  });

  return c.json<UiResponse>({
    showForm: {
      name: 'editBotComment',
      form: {
        fields: fields,
        title: 'Edit this bot comment',
        description: 'This form allows you to edit a comment that was made by a moderator as the bot. Note that moderators can always see who made and edited the comment.',
        acceptLabel: 'Edit bot comment',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/view-bot-comment-info', async (c) => {
  // Allows a mod to view the info of a bot comment
  const values = await c.req.json<{targetId?: string}>();
  const commentId = values.targetId?.slice(3) ?? '';
  const comment = await reddit.getCommentById(commentId as T1);
  if (comment == undefined) { return c.json<UiResponse>({ showToast: 'Comment not found',}, 200); }
  if (comment.authorName != 'chickenbotonceaday') { return c.json<UiResponse>({ showToast: 'This comment was not made by the bot',}, 200); }
  const commentInfo = await redis.get(`bot-comment-info-${comment.id}-version-1-v${DBVersion()}`);
  if (!commentInfo) { return c.json<UiResponse>({ showToast: 'This comment was created by the bot itself.',}, 200); }

  let versions: {label: string, value: string}[] = [{ label: 'History summary', value: 'summary' }, { label: 'Full history', value: 'full' }];
  let version = 1;
  while (true) {
    const info = await redis.get(`bot-comment-info-${comment.id}-version-${version}-v${DBVersion()}`);
    if (info) {
      versions.push({ label: `Version ${version}`, value: `${version}` });
      version++;
    }
    else { break; }
  }
  if (versions.length == 0) { return c.json<UiResponse>({ showToast: 'No versions of this comment were found.',}, 200); }

  return c.json<UiResponse>({
    showForm: {
      name: 'viewBotCommentInfo',
      form: {
        fields: [
        {
          name: 'version',
          label: 'Version',
          type: 'select',
          options: versions.map((v) => ({ label: v.label, value: v.value })),
          defaultValue: ['summary'],
          helpText: 'Select the version of the comment info you want to view.'
        },
        {
          name: 'commentId',
          label: 'Comment ID',
          type: 'string',
          defaultValue: commentId,
          helpText: 'This is the ID of the comment you want to view info for (the relevant ID is filled in automatically).',
          required: true
        }],
        title: 'View bot comment info',
        description: 'View the version history of a bot comment: which moderators made which changes at which point in time? It gets sent to you in a private message.',
        acceptLabel: 'Send comment info in a private message',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/change-settings', async (c) => {
  // Allows a mod to change the settings of the bot
  const subreddit = await reddit.getCurrentSubreddit();

  let removalReasons = await subreddit.getRemovalReasons();
  removalReasons.push({ id: 'none', title: 'None', message: 'None' });
  let defaultMultiplePostsPerDayReasonId = await redis.get(`multiple-posts-per-day-removal-reason-id-v${await DBVersion()}`) ?? 'none';
  if (!removalReasons.some((reason) => reason.id == defaultMultiplePostsPerDayReasonId)) { defaultMultiplePostsPerDayReasonId = 'none'; }
  let defaultWrongTitleReasonId = await redis.get(`wrong-title-removal-reason-id-v${await DBVersion()}`) ?? 'none';
  if (!removalReasons.some((reason) => reason.id == defaultWrongTitleReasonId)) { defaultWrongTitleReasonId = 'none'; }
  let defaultSelfieRemovalReasonId = await redis.get(`selfie-removal-reason-id-v${await DBVersion()}`) ?? 'none';
  if (!removalReasons.some((reason) => reason.id == defaultSelfieRemovalReasonId)) { defaultSelfieRemovalReasonId = 'none'; }

  const rawFlairs = await subreddit.getPostFlairTemplates();
  let flairs: { label: string, value: string }[] = [];
  for (const flair of rawFlairs) { flairs.push({ value: flair.id, label: flair.text }); }
  flairs.push({ value: 'none', label: 'None' });
  let defaultSelfieFlairId = await redis.get(`selfie-flair-id-v${await DBVersion()}`) ?? 'none';
  if (!flairs.some((flair) => flair.value == defaultSelfieFlairId)) { defaultSelfieFlairId = 'none'; }
  let defaultPoliticalFlairId = await redis.get(`political-flair-id-v${await DBVersion()}`) ?? 'none';
  if (!flairs.some((flair) => flair.value == defaultPoliticalFlairId)) { defaultPoliticalFlairId = 'none'; }
  return c.json<UiResponse>({
    showForm: {
      name: 'changeSettings',
      form: {
        fields: [{
          name: 'multiplePostsPerDayReasonId',
          label: 'Removal reason for multiple posts per day',
          type: 'select',
          options: removalReasons.map((reason) => ({ label: reason.title, value: reason.id })),
          helpText: 'Select the removal reason that will be used when a user posts multiple times in a day.',
          defaultValue: [defaultMultiplePostsPerDayReasonId]
        },
        {
          name: 'wrongTitleReasonId',
          label: 'Removal reason for wrong title',
          type: 'select',
          options: removalReasons.map((reason) => ({ label: reason.title, value: reason.id })),
          helpText: 'Select the removal reason that will be used when a user posts with the wrong title.',
          defaultValue: [defaultWrongTitleReasonId]
        },
        {
          name: 'selfieRemovalReasonId',
          label: 'Removal reason for selfie rule',
          type: 'select',
          options: removalReasons.map((reason) => ({ label: reason.title, value: reason.id })),
          helpText: 'Select the removal reason that will be used when a user breaks the selfie rule.',
          defaultValue: [defaultSelfieRemovalReasonId]      
        },
        {
          name: 'selfieFlairId',
          label: 'Selfie flair',
          type: 'select',
          options: flairs.map((flair) => ({ label: flair.label, value: flair.value })),
          helpText: 'Select the flair that is used to mark a post as a selfie.',
          defaultValue: [defaultSelfieFlairId]
        },
        {
          name: 'politicalFlairId',
          label: 'Political flair',
          type: 'select',
          options: flairs.map((flair) => ({ label: flair.label, value: flair.value })),
          helpText: 'Select the flair that is used to mark a post as political.',
          defaultValue: [defaultPoliticalFlairId]
        }],
        title: 'Change settings',
        description: 'Change some settings of the bot for this subreddit.',
        acceptLabel: 'Change settings',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/apply-rule', async (c) => {
  // Allows a mod to apply a certain rule to a post
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId;
  if (postId == undefined) { return c.json<UiResponse>({ showToast: 'Post info not found',}, 200); }
  return c.json<UiResponse>({
    showForm: {
      name: 'applyRule',
      form: {
        fields: [{
          name: 'rule',
          label: 'Rule',
          type: 'select',
          options: [
            { label: 'Selfie rule', value: 'selfie' },
            { label: 'Political rule', value: 'political' }
          ],
          helpText: 'Select the rule you want to apply to this post.'
        },
        {
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId.slice(3),
          helpText: 'This is the ID of the post you want to apply a rule to (the relevant ID is filled in automatically).'
        }],
        title: 'Apply rule',
        description: "Apply a certain rule to this post. With the selfie rule, it checks if the selfie flair is applied, if it is spoiled and if it is posted on the correct day. With the political rule, it checks if the political flair is applied and if it is spoiled. It doesn't check other aspects of these rules.",
        acceptLabel: 'Apply rule',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/view-streak-development', async (c) => {
  // Allows a mod to view the latest post of a user, and how their streak developed over these posts
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId;
  if (postId == undefined) { return c.json<UiResponse>({ showToast: 'Post info not found',}, 200); }
  const post = await reddit.getPostById(postId as T3);
  const authorName = post.authorName;
  const timezones = Intl.supportedValuesOf('timeZone')
  return c.json<UiResponse>({
    showForm: {
      name: 'viewStreakDevelopment',
      form: {
        fields: [{
          name: 'authorName',
          label: 'Author Name',
          type: 'string',
          defaultValue: authorName,
          helpText: 'This is the name of the user for whom you want to view streak development.'
        },
        {
          name: 'timeZone',
          label: 'Time Zone',
          type: 'select',
          options: timezones.map((tz) => ({ value: tz, label: tz })),
          defaultValue: ['Europe/Amsterdam'],
        },
        {
          name: 'numberOfPosts',
          label: 'Number of Posts',
          type: 'number',
          defaultValue: 6,
          helpText: 'How many posts you want to view.'
        },
        {
          name: 'includePostLink',
          label: 'Include Post Links',
          type: 'boolean',
          defaultValue: true,
          helpText: 'If checked, the link to the posts will be included in the output.'
        }],
        title: 'View streak development',
        description: 'View the development of the streak of a user over time. Works best on mobile.',
        acceptLabel: 'View streak development',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/view-post-window', async (c) => {
  // Allows a user to see when they can post again to maintain their streak
  const username = await reddit.getCurrentUsername();
  if (!username) { return c.json<UiResponse>({ showToast: 'You must be logged in to view your post window.',}, 200); }  
  const startNextPostTimeframe = await redis.zScore(`start-next-post-timeframe-v${await DBVersion()}`, username);
  const endNextPostTimeframe = await redis.zScore(`end-next-post-timeframe-v${await DBVersion()}`, username);
  let postWindowMessage = '';
  if (!startNextPostTimeframe || !endNextPostTimeframe) {
    postWindowMessage = 'Your next post window could not be determined. This is correct if you have not posted yet, or if your streak is 0, because then you have no streak to maintain. Otherwise, I will try to determine it again now. If you try again in 1 minute and it still does not work, you have to wait until you made a new post.';
    const latestPost = await redis.zRange(`posts-of-${username}-v${await DBVersion()}`, -1, -1);
    if (latestPost[0] != undefined) { await addToEndOfQueue(`streak-queue-v${await DBVersion()}`, latestPost[0].member); }
  }
  else {
    const now = new Date().valueOf();
    if (endNextPostTimeframe < now) { postWindowMessage = 'Your next post window has already passed. You can post again to start building a new streak.'; }
    else {
      if (startNextPostTimeframe > now) { postWindowMessage += `You can create your next post in ${formatDateTime(startNextPostTimeframe - now)} from now to maintain your streak.`; }
      else { postWindowMessage += 'You can create your next post now to maintain your streak.'; }
      postWindowMessage += ` Do not create it later than ${formatDateTime(endNextPostTimeframe - now)} from now. Otherwise, you will lose your streak.`;      
    }
  }
  return c.json<UiResponse>({
    showForm: {
      name: 'viewPostWindow',
      form: {
        fields: [],
        title: 'View post window',
        description: postWindowMessage,
        acceptLabel: 'Confirm',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});
