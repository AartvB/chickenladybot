# Devvit Mod Tool Template

A template for building Reddit moderation tools using Devvit web. This template provides a complete foundation for creating custom moderation tools with bulk comment management capabilities.

## Features

This template includes a working mod tool called **"Mop"** that demonstrates:

- **Bulk Comment Management**: Remove or lock multiple comments at once
- **Thread-level Actions**: "Mop comments" - Remove/lock a comment and all its replies
- **Post-level Actions**: "Mop post comments" - Remove/lock all comments on a post
- **Flexible Options**:
  - Remove comments, lock comments, or both
  - Skip distinguished comments (moderator/admin posts)
- **Permission Checks**: Only moderators with proper permissions can use the tool
- **User-friendly Forms**: Interactive forms with clear options and validation

## Tech Stack

- [Devvit](https://developers.reddit.com/): Reddit's platform for building and deploying apps
- [Vite](https://vite.dev/): Fast build tool for the web components
- [Hono](https://hono.dev/): Lightweight web framework for backend logic
- [TypeScript](https://www.typescriptlang.org/): Type-safe development

## Getting Started

1. **Clone this template** or use it as a starting point for your mod tool
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure your app** in `devvit.json`:
   - Update the app name
   - Set your development subreddit
4. **Start developing**:
   ```bash
   npm run dev
   ```
5. **Test your changes** in your development subreddit

## Project Structure

```
src/
├── index.ts          # Main server setup with Hono routes
├── core/
│   └── nuke.ts       # Core moderation logic for bulk operations
└── routes/
    ├── api.ts        # Public API endpoints
    ├── forms.ts      # Form submission handlers
    ├── menu.ts       # Context menu item handlers
    └── triggers.ts   # App lifecycle triggers
```

## Customizing Your Mod Tool

This template is designed to be easily customizable:

1. **Modify existing actions**: Edit the nuke functionality in `src/core/nuke.ts`
2. **Add new menu items**: Update `devvit.json` and add handlers in `src/routes/menu.ts`
3. **Create new forms**: Add form definitions and handlers in `src/routes/forms.ts`
4. **Add API endpoints**: Extend `src/routes/api.ts` for external integrations

## Commands

- `npm run dev`: Starts development mode with live reload on your test subreddit
- `npm run build`: Builds your mod tool for production
- `npm run deploy`: Uploads a new version of your app to Reddit
- `npm run launch`: Publishes your app for review and public use
- `npm run login`: Authenticates your CLI with Reddit
- `npm run type-check`: Runs TypeScript type checking, linting, and formatting

## How It Works

The template demonstrates Reddit mod tool development through the "Mop" feature:

1. **Context Menu Integration**: Click on the Mod Shield icon in a comment to see custom mod actions
2. **Permission Validation**: Automatically checks if the user has moderation permissions
3. **Interactive Forms**: Presents options through Reddit's native form system
4. **Reddit API**: Processes multiple comments using Reddit's API

## Development Notes

- **Permissions**: The app requires `reddit: true` permission to access Reddit's API
- **User Types**: Menu items are restricted to `moderator` user type

## Deployment

1. Test thoroughly in your development subreddit
2. Run `npm run deploy` to upload your app
3. Use `npm run launch` to submit for Reddit's app review process
4. Once approved, users can install your mod tool from Reddit's app directory

This template provides everything you need to build powerful, user-friendly moderation tools for Reddit communities.

# TODO: IMPLEMENT THE FOLLOWING FUNCTIONS
- def setup_database(self):
- def backup_database(self):
- def fill_database_after_failure(self):
- def get_all_posts(self, username):
- def get_all_users(self):
- def is_user(self, username):   
- def calculate_streak(self, username, timestamp = None):
- def record_streak(self, username):
- def record_all_streaks(self):
- def record_post_streak(self, post_id, replace = True):
- def record_post_streaks_user(self, username):
- def record_empty_post_streaks(self, batch_size = 500):
- def record_post_statistic(self, post_id):
- def record_post_statistics(self, n_days_history = 21):
- def get_text_from_flair(self, text):
- def update_user_flair(self, username):
- def update_all_flair(self):
- def get_author(self, submission):
- def add_COAD_streak(self):
- def get_posts_after(self, post_id):
- def add_post(self, post_id):
- def check_player_streak(self):
- def delete_post(self):
- def run_sql(self, query):
- def check_for_deleted_posts(self):
- def start_maintenance(self):
- def end_maintenance(self):
- def update_count_leaderboard(self):
- def update_whole_counts_leaderboard(self):
- def update_top_posts_leaderboards(self):
- def update_identical_digits_leaderboard(self):
- def update_palindrome_leaderboard(self):
- def update_streak_leaderboard(self):