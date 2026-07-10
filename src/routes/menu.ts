import { Hono } from 'hono';
import type { T3, UiResponse } from '@devvit/web/shared';
import { isInHardShutdown, isInSoftShutdown } from '../core/helpers';
import { reddit } from '@devvit/web/server';

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