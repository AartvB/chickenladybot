import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { isInHardShutdown, isInSoftShutdown } from '../core/helpers';

export const menu = new Hono();

menu.post('/toggle-shutdown', async (c) => {
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