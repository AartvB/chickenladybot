import { Hono } from 'hono';
import type { T1, T3, UiResponse } from '@devvit/web/shared';
import { DBVersion, isInHardShutdown, isInSoftShutdown } from '../core/helpers';
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

menu.post('/add-post-to-streak-database', async (c) => {
  // Allows a moderator to add a post manually to the streak database
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId?.slice(3) ?? '';
  return c.json<UiResponse>({
    showForm: {
      name: 'addPostToStreakDatabase',
      form: {
        fields: [{
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post you want to add to the streak database (the relevant ID is filled in automatically).'
        }],
        title: 'Add this post to the streak database',
        description: 'This form allows you to add a post to the streak database. This is useful if a user has posted a number but the bot did not process it for some reason. You can add the post to the database so that it counts towards their streak.',
        acceptLabel: 'Add post to streak database',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/remove-post-from-streak-database', async (c) => {
  // Allows a mod to remove a post manually from the streak database
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId?.slice(3) ?? '';
  return c.json<UiResponse>({
    showForm: {
      name: 'removePostFromStreakDatabase',
      form: {
        fields: [{
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post you want to remove from the streak database (the relevant ID is filled in automatically).'
        }],
        title: 'Remove this post from the streak database',
        description: 'This form allows you to remove a post from the streak database. This is useful if a post was added to the database by mistake and you want to remove it.',
        acceptLabel: 'Remove post from streak database',
        cancelLabel: 'Cancel'
      },
    },
  }, 200);
});

menu.post('/add-manual-streak', async (c) => {
  // Allows a mod to set the streak of the user at a certain post
  const values = await c.req.json<{targetId?: string}>();
  const postId = values.targetId?.slice(3) ?? '';
  return c.json<UiResponse>({
    showForm: {
      name: 'addManualStreak',
      form: {
        fields: [{
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post for which you want to add the streak to the database (this can be a post in the current subreddit or one in r/CountOnceADay).'
        },
        {
          name: 'streak',
          label: 'Streak Length',
          type: 'number',
          helpText: 'Enter the length of the streak you want to add.'
        }],
        title: 'Add a manual streak',
        description: 'This form allows you to add a manual streak for a user. This is mainly useful for if a user moves from r/CountOnceADay to the current subreddit and you want to add their streak to the database. In that case put the post ID of their last post in r/CountOnceADay and the length of their streak.',
        acceptLabel: 'Add manual streak',
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
          helpText: 'If checked, the post will be locked and no new comments can be made.'
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
        fields: [
        {
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post you want to edit (the relevant ID is filled in automatically).',
          required: true
        },
        {
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
        fields: [
        {
          name: 'postId',
          label: 'Post ID',
          type: 'string',
          defaultValue: postId,
          helpText: 'This is the ID of the post you want to view info for (the relevant ID is filled in automatically).',
          required: true
        },
        {
          name: 'version',
          label: 'Version',
          type: 'select',
          options: versions.map((v) => ({ label: v.label, value: v.value })),
          defaultValue: ['summary'],
          helpText: 'Select the version of the post info you want to view.'
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
  let fields: any[] = [
    {
      name: 'targetId',
      label: 'Response To (Post or Comment) ID',
      type: 'string',
      defaultValue: values.targetId,
      helpText: 'This is the ID of the post or comment you want to respond to as the bot (the relevant ID is filled in automatically).',
      required: true
    },
    {
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
    }
  ]
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
    helpText: 'If checked, the comment will be locked and no new comments can be made below it.'
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
      name: 'commentId',
      label: 'Comment ID',
      type: 'string',
      defaultValue: values.targetId,
      helpText: 'This is the ID of the comment you want to edit (the relevant ID is filled in automatically).',
      required: true
    },
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
    helpText: 'If checked, the comment will be locked and no new comments can be made below it.'
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
          name: 'commentId',
          label: 'Comment ID',
          type: 'string',
          defaultValue: commentId,
          helpText: 'This is the ID of the comment you want to view info for (the relevant ID is filled in automatically).',
          required: true
        },
        {
          name: 'version',
          label: 'Version',
          type: 'select',
          options: versions.map((v) => ({ label: v.label, value: v.value })),
          defaultValue: ['summary'],
          helpText: 'Select the version of the comment info you want to view.'
        }],
        title: 'View bot comment info',
        description: 'View the version history of a bot comment: which moderators made which changes at which point in time? It gets sent to you in a private message.',
        acceptLabel: 'Send comment info in a private message',
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