import { Injectable, Logger } from '@nestjs/common';
import type { GenerateInstantContentRequest } from '@contivo/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIResult {
  content: string;
  creditsCost: number;
  model: string;
  tokensUsed: { prompt: number; completion: number; total: number };
}

// ─── Prompt registry ─────────────────────────────────────────────────────────
//
// Each entry defines the credit cost and a system prompt.
// When a real OpenAI key is available, replace `mockGenerate` with
// `this.openai.chat.completions.create(...)` inside `execute()`.
//
interface PromptDefinition {
  key: string;
  model: string;
  creditCost: number;
  systemPrompt: string;
}

const PROMPT_REGISTRY: Record<string, PromptDefinition> = {
  INSTANT_linkedin: {
    key: 'INSTANT_linkedin',
    model: 'gpt-4o',
    creditCost: 5,
    systemPrompt:
      'You are an expert LinkedIn content creator. Write engaging, authentic LinkedIn posts (150-300 words). Use line breaks. No hashtags unless requested.',
  },
  INSTANT_twitter: {
    key: 'INSTANT_twitter',
    model: 'gpt-4o',
    creditCost: 5,
    systemPrompt:
      'Write a Twitter/X thread of 5-7 numbered tweets. Each tweet ≤280 characters. First tweet must hook immediately.',
  },
  INSTANT_instagram: {
    key: 'INSTANT_instagram',
    model: 'gpt-4o',
    creditCost: 4,
    systemPrompt:
      'Write an Instagram caption with a strong opening, value body, and CTA. Add 5-10 relevant hashtags at the end.',
  },
  INSTANT_email: {
    key: 'INSTANT_email',
    model: 'gpt-4o',
    creditCost: 6,
    systemPrompt:
      'Write a persuasive email. Start with "Subject: [subject line]". Then write a concise, value-driven email with a single CTA.',
  },
  INSTANT_blog: {
    key: 'INSTANT_blog',
    model: 'gpt-4o',
    creditCost: 5,
    systemPrompt:
      'Create a blog post outline: compelling title, meta description (prefix "Meta: "), intro hook, 5-7 H2 sections with 3 bullet points each, conclusion.',
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  /**
   * Generate instant content.
   *
   * Currently uses a deterministic mock generator so the feature works
   * without an OpenAI key. To switch to real OpenAI:
   *   1. pnpm add openai
   *   2. In `execute()`, replace `this.mockGenerate(...)` with:
   *      const res = await this.openai.chat.completions.create({ model, messages, temperature: 0.7 });
   *      return res.choices[0]?.message?.content ?? '';
   */
  async generateInstantContent(input: GenerateInstantContentRequest): Promise<AIResult> {
    const promptKey = `INSTANT_${input.channel}`;
    const prompt = PROMPT_REGISTRY[promptKey] ?? PROMPT_REGISTRY['INSTANT_linkedin'];
    const userMessage = this.buildUserMessage(input);
    return this.execute(prompt, userMessage);
  }

  private async execute(prompt: PromptDefinition, userMessage: string): Promise<AIResult> {
    this.logger.log(`AI execute: key=${prompt.key} (mock)`);

    // ── Mock generation ───────────────────────────────────────────────────────
    // Replace this block with a real provider call when ready.
    const content = this.mockGenerate(prompt.key, userMessage);
    const tokensUsed = { prompt: 120, completion: 280, total: 400 };
    const creditsCost = prompt.creditCost;
    // ─────────────────────────────────────────────────────────────────────────

    return { content, creditsCost, model: `mock/${prompt.model}`, tokensUsed };
  }

  // ─── Mock generator ───────────────────────────────────────────────────────
  private mockGenerate(promptKey: string, userMessage: string): string {
    // Extract topic from the user message for realistic-looking output
    const topicMatch = userMessage.match(/Topic:\s*(.+)/);
    const topic = topicMatch?.[1]?.trim() ?? 'your topic';


    const templates: Record<string, () => string> = {
      INSTANT_linkedin: () => `Here's an insight that changed how I think about ${topic}:

Most people approach this the wrong way.

They focus on the output — the metrics, the deliverables, the visible work.

But the real leverage is upstream.

When I shifted my focus to ${topic} systematically, three things happened:
→ Decision-making became faster and clearer
→ The team stopped second-guessing the direction
→ Results followed naturally

The lesson? The work that feels invisible is often the work that matters most.

What's one area where you could go deeper on ${topic} this week?`,

      INSTANT_twitter: () => `1/ Most people get ${topic} completely backwards. Here's what actually works: 🧵

2/ The conventional approach focuses on the wrong metric. Everyone optimizes for vanity numbers instead of what drives real results.

3/ When you shift to focusing on ${topic} properly, the first thing you notice is clarity. The noise disappears.

4/ Here's the framework that works:
- Start with the outcome you actually want
- Work backwards to the inputs that drive it
- Remove everything that doesn't directly contribute

5/ The compounding effect is real. Small, consistent improvements in ${topic} beat one-time big swings every time.

6/ The uncomfortable truth: most of us know what to do. We just don't do it consistently.

7/ Start with one change today. Apply it to ${topic}. That's it. See what happens next week.`,

      INSTANT_instagram: () => `The one thing about ${topic} nobody talks about? ✨

It's not about doing more. It's about doing the right things — consistently.

Here's what I've learned:

✅ Focus beats hustle every time
✅ Systems outlast motivation
✅ Progress compounds when you stay the course

Whether you're just starting with ${topic} or you've been at it for years — the fundamentals never change.

Double tap if this resonates 🙌

What's your approach to ${topic}? Drop it in the comments 👇

#${topic.replace(/\s+/g, '')} #growth #strategy #contentmarketing #business #mindset #marketing #success #entrepreneur #focus`,

      INSTANT_email: () => `Subject: The ${topic} strategy you're probably overlooking

Hi [First Name],

I want to share something that's been on my mind about ${topic}.

Most approaches focus on what's visible — the tactics, the tools, the outputs. But there's a layer underneath that drives everything, and it's usually invisible until you know what to look for.

**What actually works:**

The teams and individuals seeing real results with ${topic} share one trait: they've built a system around it, not just a habit.

That means:
- A clear process that doesn't depend on motivation
- Defined inputs that lead to measurable outputs
- Regular checkpoints to adjust and improve

**What I'd love you to do:**

Take 10 minutes this week and map out your current approach to ${topic}. You'll immediately see where the gaps are.

If you want to talk through it, just reply to this email.

[Your Name]`,

      INSTANT_blog: () => `# ${topic.charAt(0).toUpperCase() + topic.slice(1)}: The Complete Guide for 2025

Meta: A comprehensive, actionable guide to ${topic} — covering everything from fundamentals to advanced strategy for modern practitioners.

## Introduction
${topic} is one of the most discussed — and most misunderstood — topics in the industry today. This guide cuts through the noise and gives you a clear, practical path forward.

## 1. Understanding the Fundamentals
- What ${topic} actually means (and what it doesn't)
- Why most approaches fail in the first 90 days
- The core principles that separate high performers

## 2. Building Your Foundation
- The three pillars every successful ${topic} strategy rests on
- Common mistakes to avoid from day one
- How to assess where you stand right now

## 3. The Right Framework
- Step-by-step implementation approach
- How to adapt the framework to your specific context
- Measuring what actually matters

## 4. Advanced Strategies
- What works at scale vs. what works early-stage
- Compounding your results over time
- Integrating ${topic} into your existing workflows

## 5. Troubleshooting Common Problems
- Why your results plateau — and how to break through
- Adjusting your approach when conditions change
- Red flags to watch for early

## 6. Tools and Resources
- The minimal toolkit you actually need
- What to invest in first vs. what can wait
- Recommended resources for going deeper

## 7. Building for the Long Term
- Making ${topic} sustainable, not just a sprint
- How to maintain momentum over months and years
- Sharing wins with your team and stakeholders

## Conclusion
${topic} done right is a compounding asset. Start with the fundamentals, build your system, and stay consistent. The results follow.`,
    };

    const generator = templates[promptKey] ?? templates['INSTANT_linkedin'];
    return generator();
  }

  private buildUserMessage(input: GenerateInstantContentRequest): string {
    let message = `Topic: ${input.topic}`;
    if (input.tone) message += `\nTone: ${input.tone}`;
    if (input.additionalContext) message += `\nAdditional context: ${input.additionalContext}`;
    return message;
  }
}
