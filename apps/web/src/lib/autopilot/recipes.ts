/**
 * autopilot/recipes.ts
 *
 * An agent is a named Autopilot policy. A recipe is the preset it starts from.
 *
 * There is no separate agent engine: the runner already ideates, drafts,
 * quality-gates and schedules from a policy, so an agent is that policy with a
 * name, a channel set and steering that suit one job. This keeps one code path
 * for everything and means a new agent type is a data change, not a build.
 */

import type { ContentChannel } from '@prisma/client';

export type RecipeKey =
  | 'linkedin_voice'
  | 'blog_writer'
  | 'thought_leader'
  | 'product_updates'
  | 'custom';

export type AgentRecipe = {
  key: RecipeKey;
  name: string;
  /** One line the user reads when choosing. */
  tagline: string;
  /** What it will actually do, in specifics. */
  description: string;
  defaults: {
    postsPerWeek: number;
    channels: ContentChannel[];
    windowStartHour: number;
    windowEndHour: number;
    publishDays: number[];
    goal: string;
    topicHints: string[];
    avoidTopics: string[];
  };
  /** Channels this recipe needs before it can publish anything. */
  requires: 'social' | 'site' | 'either';
};

export const AGENT_RECIPES: AgentRecipe[] = [
  {
    key: 'linkedin_voice',
    name: 'LinkedIn voice',
    tagline: 'Short, opinionated posts in your voice, a few times a week.',
    description:
      'Writes first-person LinkedIn posts from your brand memory and the gaps your competitors leave open. Publishes inside working hours on weekdays.',
    defaults: {
      postsPerWeek: 3,
      channels: ['linkedin'],
      windowStartHour: 9,
      windowEndHour: 18,
      publishDays: [1, 2, 3, 4, 5],
      goal: 'authority',
      topicHints: [],
      avoidTopics: ['pricing', 'politics'],
    },
    requires: 'social',
  },
  {
    key: 'blog_writer',
    name: 'Blog writer',
    tagline: 'Long-form articles published straight to your website.',
    description:
      'Produces 600–2,200 word articles aimed at the keyword gaps found in your competitive analysis, published through the Content API to your own site.',
    defaults: {
      postsPerWeek: 1,
      channels: ['blog'],
      windowStartHour: 8,
      windowEndHour: 12,
      publishDays: [2],
      goal: 'education',
      topicHints: [],
      avoidTopics: [],
    },
    requires: 'site',
  },
  {
    key: 'thought_leader',
    name: 'Thought leader',
    tagline: 'Fewer posts, bigger arguments, aimed at your buyer.',
    description:
      'One or two substantial posts a week that take a position, rather than steady volume. Best when you would rather be quoted than seen daily.',
    defaults: {
      postsPerWeek: 2,
      channels: ['linkedin'],
      windowStartHour: 7,
      windowEndHour: 10,
      publishDays: [2, 4],
      goal: 'authority',
      topicHints: [],
      avoidTopics: ['pricing', 'politics', 'competitor names'],
    },
    requires: 'social',
  },
  {
    key: 'product_updates',
    name: 'Product & offers',
    tagline: 'Turns what you sell into a steady drumbeat.',
    description:
      'Writes about your products and services, framed against what competitors offer. Uses the Products & Services intelligence rather than general commentary.',
    defaults: {
      postsPerWeek: 2,
      channels: ['linkedin'],
      windowStartHour: 10,
      windowEndHour: 16,
      publishDays: [1, 3],
      goal: 'leads',
      topicHints: [],
      avoidTopics: ['politics'],
    },
    requires: 'social',
  },
  {
    key: 'custom',
    name: 'Custom agent',
    tagline: 'Start blank and set every dial yourself.',
    description: 'Same engine, no opinions. Choose the cadence, channels, window and steering.',
    defaults: {
      postsPerWeek: 3,
      channels: ['linkedin'],
      windowStartHour: 9,
      windowEndHour: 18,
      publishDays: [1, 2, 3, 4, 5],
      goal: 'authority',
      topicHints: [],
      avoidTopics: [],
    },
    requires: 'either',
  },
];

export function getRecipe(key: string | null | undefined): AgentRecipe | undefined {
  return AGENT_RECIPES.find((r) => r.key === key);
}
