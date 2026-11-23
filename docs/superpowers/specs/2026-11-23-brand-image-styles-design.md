# Brand image styles: design

- **Status:** draft for Farjad. **Not to be built** until the first-post path is designed
  (session `first-post-path-cpo`, `.claude/agent-org/work/strategy/2026-11-23-first-post-path.md`),
  because the style picker becomes one step inside that path.
- **Owner:** contivo-cpo.
- **Decision note:** `.claude/agent-org/work/strategy/2026-11-23-image-styles.md` (Farjad with
  contivo-cofounder, 23 Nov).
- **Evidence:** `docs/evals/2026-11-23-image-reference-eval.md`, a live eval run on 23 Nov for $0.86.

## 1. Goal

Each brand's post images should look like that brand and stay consistent across posts. The
brand picks the look once, from pictures of its own post, not from a list of names. On paid
plans, the brand can bring its own prompt, reference images and real photos. Plans limit the
**number of images**, not the number of styles.

**Out of scope:**
- video;
- text written by the model inside images (never);
- editing faces;
- a free-form "describe any image" field for each post;
- Instagram or other channel formats beyond the three below.

## 2. What exists today (main, 23 Nov, verified in code)

| Piece | Where | Notes |
|---|---|---|
| 3 base types `photo \| illustration \| abstract`, picked from the industry | `apps/web/src/lib/content-image-brief.ts` (`styleForIndustry`, `STYLE_LINE`) | The user never chooses. |
| Brief: post → concrete subject, framing rotated by `compositionFor(seed)` | same file, `content-image.ts` `buildImageBrief` | The no-text rule is restated on every prompt. |
| Model chain `gpt-image-2.5-flare` → `2.6-flare` → `2.5-sunburst`, 1024², medium, coded failures | `apps/web/src/lib/ai/image.ts` | **Generations endpoint only.** No edits or references. |
| Image bytes stored in Postgres | `ContentImage.data Bytes` (`schema.prisma`), one row per content item | Fine for one generated PNG per post. Not for user uploads (§8). |
| Brand memory | `Workspace.brandSummary Json` | There is no image-style field today. |
| Plan image quotas: Free 0, Founder 13, Growth 34, Agency 144 per month; `IMAGE_PACK` 55 for $34 | `lib/plans.ts` on the unmerged `pricing-packages` branch | The wallet spec folds `IMAGE_PACK` into credits (wallet spec §8.2). |
| Text overlay or carousel template, Vazirmatn rendering | **does not exist** | The decision note assumes it. This is new work (§5.4). |

## 3. The style model

A style is three layers. Each layer is resolved separately and joined into one prompt at
generation time.

### 3.1 Layer 1: base type (exists)

The three existing types are `photo`, `illustration` and `abstract`. They stay the backbone, and
`styleForIndustry` stays as the default when nothing has been picked.

### 3.2 Layer 2: brand look

The brand look sets palette, mood, light, texture and composition habits. It is one of:

- **A house look**, from our library. Each look belongs to a base type, so the style stays
  compatible with today's brief. Start with 8:

  | Look id | Base | One-line art direction (English, fed to the model) |
  |---|---|---|
  | `photo-natural` | photo | Today's line: candid editorial photo, available light. |
  | `photo-studio` | photo | Clean studio, seamless colour backdrop from the brand palette, hard or soft key light. |
  | `photo-warm-film` | photo | Warm film tones, soft grain, golden light, shallow depth. |
  | `illus-flat` | illustration | Today's line: flat colour, limited palette, simple shading. |
  | `illus-line` | illustration | Ink line drawing with one or two accent colours. |
  | `illus-print` | illustration | Two-ink print look (linocut or risograph), paper grain. |
  | `illus-3d-soft` | illustration | Soft clay-like 3D objects, matte, pastel light. |
  | `abstract-shapes` | abstract | Today's abstract line. |

- **The brand's own style** (Professional only, §6). It is built from the user's prompt and
  3–5 reference images (§7).

  A brand look also carries the brand palette: up to 3 hex colours from brand memory, or from
  the references.

### 3.3 Layer 3: format (follows the content, not the user)

| Content type | Format | Generated at | Delivered as |
|---|---|---|---|
| LinkedIn or Telegram post | single image, **1:1** by default; **4:5** when the post is long or the framing is a portrait | 1024×1024, or 1024×1536 cropped to 4:5 | PNG 1080×1080 or 1080×1350 |
| Article (site, blog, Content API) | **16:9 cover** + optional inline images (max 2 per article, paid only) | 1536×1024 cropped to 16:9 | 1600×900 cover; inline 1200×800 |
| Data or list post (≥3 numbered items or figures) | **carousel from our template**: cover + one slide per item + end card | No model text. At most 1 generated background image per carousel, in the brand look; all text and numbers rendered by us | PDF (LinkedIn document) and PNG set (Telegram album) |

The model only makes three sizes: 1024², 1536×1024 and 1024×1536. So the brief must keep the
focal subject centred, with a 10% safe margin, before the crop. `compositionFor` gets one rule
per format.

**Content type detection.** The content item already knows its channel (post or article).
"Data or list" is a flag the draft step sets: ≥3 list items or ≥2 figures. The user can switch
a post between single image and carousel in the editor. That is the only format control.

### 3.4 Saved shape (brand memory)

The style lives in a new nullable key `brandSummary.imageStyle`. **Schema change: none for
the picker.** The upload tables in §8 need one additive migration, owned by
contivo-database-engineer when built.

```ts
type BrandImageStyle = {
  version: 1;
  baseType: 'photo' | 'illustration' | 'abstract';
  lookId: string;                 // a house look id, or 'custom'
  palette?: string[];             // ≤3 hex
  styleCard?: string;             // ≤60 words, English; for 'custom' it is written from the references (§7.2)
  userPrompt?: string;            // sanitised form only (§7.1); the raw text is kept in audit only
  referenceAssetIds?: string[];   // 3–5 BrandAsset ids (§8), Professional only
  pickedFrom?: { contentItemId: string; at: string };
  source: 'picker' | 'default' | 'settings';
};
```

## 4. The onboarding picker

### 4.1 Flow

1. **Trigger.** The picker opens after the first draft exists, as one step of the first-post
   path. Its exact place belongs to the `first-post-path-cpo` design. It must never block
   publishing: "Choose for me" keeps the industry default.
2. **Renders.** We render **that same draft** in 6 looks. It is the user's real post, not a
   sample. The brief (subject, setting, alt) is written **once** and reused for all 6, so only
   the look differs. That makes the comparison fair and costs one brief call.
   - Paid plans: 6 looks, chosen as 2 per base type, with the industry's default type first.
   - Free: the 3 base types only (one render each).
3. **Display.** A grid of 6 (2×3 on mobile). Each card shows only the image. Look names are
   not shown; the user judges the picture.
4. **Pick.**
   - Clicking a card saves `imageStyle` and attaches that image to the draft, so the pick is
     not wasted.
   - "Show me different ones" renders one more batch, once.
   - "Choose for me" keeps the default.
5. **Change later.** The same grid lives in Workspace settings → Images. It renders the
   latest draft and counts against the monthly image quota. The onboarding renders do not
   count.

### 4.2 Cost

The picker costs **6 × $0.014 ≈ $0.09 per workspace**, plus one brief call. A reroll adds
another $0.09. Free costs about $0.04. This is paid by us as acquisition cost and is not
counted against the user's quota. Renders run in parallel, about 12 s (eval latency).

### 4.3 House looks: references or text?

House looks are **text-only** ("style cards"): $0.013 per image. Reference images cost
$0.038–0.047 per image and add about 10 s. We keep a reference set for each house look only
if a follow-up eval shows that text alone drifts across 20 posts. That eval has not been run.
Owner: contivo-head-of-data, about $2.

### 4.4 Copy (en / fa)

The Persian is written as Persian, not translated (`contivo-persian-copy.md`).

| Key | English | فارسی |
|---|---|---|
| `picker.title` | Pick the look for your images | تصویرهای پست‌هایتان چه حال‌وهوایی داشته باشند؟ |
| `picker.body` | We pictured your post "{title}" six ways. Pick the one that feels like your brand — you can change it later in Settings. | پست «{title}» را به شش شکل تصویر کرده‌ایم. هر کدام که به برندتان نزدیک‌تر است انتخاب کنید؛ بعداً هم از تنظیمات می‌شود عوضش کرد. |
| `picker.bodyFree` | We pictured your post "{title}" three ways. Pick the one that feels like your brand. | پست «{title}» را به سه شکل تصویر کرده‌ایم. هر کدام که به برندتان نزدیک‌تر است انتخاب کنید. |
| `picker.use` | Use this look | همین را می‌خواهم |
| `picker.more` | Show me different ones | چند نمونه‌ی دیگر نشانم بده |
| `picker.skip` | Choose for me | خودتان انتخاب کنید |
| `picker.loading` | Drawing your post… | داریم پستتان را تصویر می‌کنیم… |
| `picker.failed` | We couldn't draw these right now. Your post is ready without an image, and you can pick a look later in Settings. | الان نشد تصویرها را بسازیم. پستتان بدون تصویر آماده است و بعداً می‌توانید از تنظیمات سبک تصویر را انتخاب کنید. |

## 5. Generation pipeline changes

### 5.1 Prompt assembly (order matters)

```
[brief: concrete subject + setting from the post]      ← today, unchanged
[look: STYLE_LINE or styleCard + palette]              ← new, replaces STYLE_LINE lookup
[format: framing + safe-margin rule for the crop]      ← new
[sanitised userPrompt, inside <request> tags]          ← paid, §7.1
[hard rules: no text / no names / no clichés]          ← today, always last and always present
```

### 5.2 Endpoints

| Case | Endpoint | Cost per image (eval) |
|---|---|---|
| House look, or a custom style with a text style card | `/v1/images/generations` | $0.013 |
| Custom style using the references directly | `/v1/images/edits` with 3–5 `image[]` | $0.038–0.047 |
| Product or team photo, "AI scene" mode | `/v1/images/edits`, 1 photo | $0.019–0.022 |
| Product or team photo, "exact" mode | no model for the subject. A cut-out and composite on a generated or plain background (§7.3) | $0.013 for the background + cut-out cost |

Required change: a `generateOpenAiImageEdit` in `ai/image.ts` with the same model chain,
causes and events. Notes from the eval:
- **`input_fidelity` is rejected by both flare models.** Do not send it.
- `2.5-sunburst` was not tested on edits.

### 5.3 Two guards for the no-text rule

The eval showed that wrapping the user's words in our rules is not enough. It failed 9 of 10.

1. **Rewrite before generation.** Any user-authored text (§7.1) goes through a text model that
   returns a picture description with every requested word, number, name and brand removed,
   and every text-bearing surface made blank. This passed 12 of 12 in the eval, for about
   $0.0002.
2. **Check after generation.** A vision call answers "is there readable text, a digit or a
   logo?" on every image whose prompt included user text or references. A product photo's own
   label is excluded, because the check is given the uploaded photo too.
   - On a yes: regenerate once with the rewrite tightened.
   - On a second yes: the post ships without the image, with a new cause `IMAGE_TEXT_DETECTED`.
   - Cost: about $0.001.

### 5.4 Text and carousel template (new, prerequisite for carousels and overlays)

There is no renderer for text or carousels today. We need a server-side renderer (satori or
`@vercel/og` + `sharp`, or the render worker on `feat/video-pipeline`) with:
- Vazirmatn for Persian (RTL) and the brand font or Inter fallback for Latin;
- a cover, item and end card in the brand palette;
- PDF output for LinkedIn and a PNG set for Telegram.

It needs its own spec. It is the largest piece of work here.

## 6. Plan limits and wallet

The decision note's rule is to limit **images per month and formats, not styles**. Mapped onto
the catalogue in `lib/plans.ts` (pricing-packages branch). The mapping is an open question
(Q1).

| | Free | Founder $55 | Growth $89 | Agency $233 ("Professional") |
|---|---|---|---|---|
| Looks | 3 base types | full house library (8) | full house library | library + **brand's own style** |
| Picker renders | 3 | 6 | 6 | 6 + one "your style" render |
| Images per month | **0 in `plans.ts` today, but the decision note implies some** (Q2) | 13 | 34 | 144 |
| Formats | single post image 1:1 | + 4:5, article cover 16:9 | + inline article images, carousel | all |
| Import: own prompt (§7.1) | — | yes | yes | yes, advanced field |
| Import: references (§7.2) | — | — | — | yes (3–5) |
| Import: product or team photos (§7.3) | — | yes (≤10 assets) | yes (≤30) | yes (≤100) |
| Extra images | — | wallet | wallet | wallet |

**Counting.** One image counts once **when it is attached to a content item and shown**. These
do not count:
- failed generations;
- the onboarding picker;
- the post-check regeneration (§5.3).

A user regeneration counts. A carousel counts as **1 image** when it uses one generated
background, and as 0 when it uses none.

**Wallet.** The wallet spec uses 1 credit = US$0.10 list (wallet spec §6.1). It also folds
`IMAGE_PACK` into credits (§8.2) and requires capture only on proof of output (§6.3). Rules:
- **Proposal:** 1 credit per extra image, of any kind. The most expensive path measured
  (4 references on the fallback model) is $0.077, so 1 credit keeps a margin on every path.
  The monetization specialist sets the final number from real `AiUsageLog` rows (§9).
- Reserve before generation. Capture only when the image is stored and passed the check.
  Release on any `IMAGE_*` failure cause.
- The extra-image add-on goes in after wallet v1 (wallet spec §5 excludes the image pack from
  v1).

## 7. Import (paid plans)

### 7.1 The user's own prompt

- It is one field in Settings → Images, saved with the style, not typed for each post. It has
  500 characters on paid plans and 1,500 on Professional ("advanced").
- It is **never sent raw.** On save, it goes through the rewrite in §5.3 and is moderated
  (OpenAI moderation, free). We store the sanitised version and use only that. The user sees
  the sanitised version ("this is what we'll use") and can edit it.
- The rewrite refuses or strips:
  - text in pixels;
  - named artists;
  - brands and trademarks;
  - real or identifiable people;
  - unsafe content.

  **Removing an artist's name does not remove the artist's look.** In the eval, "in the style
  of a named director" became a description that still produced that look (Q4).

| Key | English | فارسی |
|---|---|---|
| `prompt.label` | Describe your image style | سبک تصویرهایتان را توصیف کنید |
| `prompt.help` | Colours, light, mood, setting. Words go on top of the image, not inside it — write them in your post and we add them in your brand font. | رنگ، نور، حال‌وهوا، فضا. نوشته روی تصویر قرار می‌گیرد، نه داخل آن؛ متن را در خود پست بنویسید تا ما با فونت برندتان رویش بگذاریم. |
| `prompt.sanitised` | This is what we'll use: | این همان چیزی است که به کار می‌بریم: |
| `prompt.refusedNames` | We can't use names of artists, brands or real people. Describe the look instead — colours, light, mood. | نام هنرمند، برند یا آدم واقعی را نمی‌توانیم به کار ببریم. به‌جایش حال‌وهوا را توصیف کنید: رنگ، نور، فضا. |
| `prompt.refusedUnsafe` | We can't make images like this. | این نوع تصویر را نمی‌سازیم. |

### 7.2 Reference images (3–5; style only)

- They are uploaded in Settings → Images → "Your own style" (Professional). They are used as a
  **style reference only**, never published and never shown to anyone else.
- **On upload:**
  - moderation check;
  - reject images under 512 px;
  - warn if a face or text is detected ("references with words or faces may leak into your
    images").
- **When the set is saved:** we produce a **style card** with a vision model. It is 60 words
  plus a palette, and the user can read and edit it. Default generation uses the card on the
  text-only path at $0.013. Using the references directly ($0.038–0.047) is a per-workspace
  switch we turn on only if the card drifts (§4.3).
- **The eval showed** style transfer from 3–4 references works on both flare models: 6 of 6
  matched, and no subject was copied.

| Key | English | فارسی |
|---|---|---|
| `refs.title` | Images whose style you like | تصویرهایی که سبکشان را دوست دارید |
| `refs.help` | Add 3 to 5. We use them only to learn your style; they are never published. | ۳ تا ۵ تصویر اضافه کنید. فقط برای شناختن سلیقه‌تان به کار می‌روند و هیچ‌جا منتشر نمی‌شوند. |
| `refs.card` | How we'll describe your style: | سبک شما را این‌طور توصیف می‌کنیم: |

### 7.3 The user's own product or team photos

The user picks one photo for a post, in the editor or as a default product shot. There are two
modes:

- **Exact (the default).** The photo's pixels are not changed. We cut out the subject (or use
  the photo full-frame), crop it to the format and place it in our template on a plain or
  generated brand background. This is the only mode that can promise "your product is never
  altered". **It needs a background-removal component we do not have** (Q6).
- **AI scene (product photos only, opt-in for each image).** The model re-lights and places
  the product in a scene. In the eval, the wordmark, rings and shape survived in 5 of 5 edits.
  But the model **redraws** the product: even a mask left 4% of the product's pixels visibly
  changed. The UI labels these images "AI-edited scene". This mode is **disabled for**:
  - photos with people;
  - products in regulated categories (food, health) whose label text matters.
- **Team photos with faces are never sent to an image model.** Only Exact mode applies. A
  redrawn face is a different person, and the subject consented to their photo, not to a
  synthetic version of themselves.

| Key | English | فارسی |
|---|---|---|
| `photos.title` | Your product or team photos | عکس محصول یا تیم‌تان |
| `photos.rights` | I own these photos or have permission to use them, and anyone recognisable in them has agreed to appear in our posts. | این عکس‌ها مال خودم است یا اجازه‌ی استفاده از آن‌ها را دارم، و هر کسی که در عکس شناخته می‌شود با آمدنش در پست‌های ما موافق است. |
| `photos.modeExact` | Use my photo as is | عکس خودم را دست‌نخورده بگذار |
| `photos.modeScene` | Place my product in a new scene (AI-edited) | محصولم را در صحنه‌ای تازه بگذار (ویرایش‌شده با هوش مصنوعی) |
| `photos.peopleNote` | Photos with people are always used as they are. | عکس‌هایی که آدم در آن‌ها هست همیشه دست‌نخورده استفاده می‌شوند. |
| `photos.delete` | Delete photo | حذف عکس |
| `photos.deleteConfirm` | It is removed from your library and from posts not yet published. Posts already published keep their image. | از کتابخانه‌تان و از پست‌هایی که هنوز منتشر نشده‌اند پاک می‌شود. پست‌هایی که منتشر شده‌اند تصویرشان را نگه می‌دارند. |

## 8. Storage, rights and deletion

### 8.1 Storage

- **Uploads do not go into Postgres bytes.** Today `ContentImage.data` holds one generated PNG
  per post. Uploads are user originals, up to 20 MB each and up to 100 per workspace, which is too
  much for Neon. Uploads go to object storage (Railway bucket or Cloudflare R2; contivo-devops-engineer
  chooses), private, with a key per workspace (`ws/{workspaceId}/assets/{id}`), served only
  through signed URLs that last 5 minutes.
- **New table `brand_assets`** (one additive migration). Fields:

  ```
  id, workspaceId, kind REFERENCE|PRODUCT|TEAM, storageKey, mimeType, width, height,
  sha256, hasPeople, rightsConfirmedAt, rightsConfirmedByUserId, rightsTextVersion,
  moderation Json, createdAt, deletedAt
  ```

  The foreign key to `workspaces` uses `onDelete: Cascade`.
- **Generated images keep the current path** (`content_images`) and gain a `sourceAssetIds`
  column, so a deletion can find what used an asset.

### 8.2 Rights confirmation

- A checkbox on every upload batch (`photos.rights`). The upload is refused without it.
- We store who confirmed it, when, and which version of the text, as evidence.
- The Terms get a clause on user-supplied images (licence to process them for the service,
  user warranty, takedown). Owner: contivo-legal-compliance-specialist.

### 8.3 Deletion

- **Deleting an asset:**
  - sets `deletedAt` and removes the asset at once from future generation and from unpublished
    drafts (the image is detached, not regenerated);
  - hard-deletes the object within 24 h.
- **Deleting a workspace or an account** cascades the rows and hard-deletes the objects within
  24 h.
- **Already-published posts** keep their image on LinkedIn and Telegram. We cannot recall it
  there, and the UI says so.
- **What remains elsewhere:**
  - Neon branches and backups keep rows for their retention window, but only metadata, because
    the bytes are in object storage.
  - Images sent to OpenAI may be kept by OpenAI for abuse monitoring under its API data terms.

## 9. Cost per image

- **From production `AiUsageLog`: no data.**
  - This session was not allowed to query production.
  - The local database has 70 usage rows and **zero `content_image` rows**.
- **From the eval (real API calls, list price, 23 Nov):** these replace earlier estimates until
  production rows exist.

| Path | $ per image |
|---|---|
| Text-only house look, 1024² medium | **0.013–0.014** |
| + brief call (gpt text model, today) | about 0.001 (not re-measured) |
| + user-prompt rewrite | 0.0002 (once at save, not per image) |
| + post-generation check | about 0.001 (estimate, not measured) |
| Custom style using 3 / 4 references directly | 0.038 / 0.047 |
| Product edit, 1 photo | 0.019–0.022 |
| Fallback `2.6-flare`, same call | about 1.7–3.3× the above |
| Onboarding picker (6 renders) | about 0.09 per workspace |

**Action** (contivo-head-of-data, after PR #66 is live for a week): pull `ai_usage_logs where
feature in ('content_image','content_image_failed')` from production and replace this table.

**Bug.** `ai-usage.ts` prices image models at the text-input rate only. Image-input tokens are
$8, not $5 per 1M, so edits would be under-recorded. Fix it before edits ship.

## 10. Success metric and the riskiest assumption

- **Riskiest assumption** (from the decision note): the image style affects whether a post is
  published or performs.
- **Test before building the picker:**
  - hand-make the 6-look grid for one real draft from each of 3 mentee teams (cost about $0.30,
    `scripts/` in the eval folder);
  - record whether the pick stays stable when the grid is shown again a week later with a
    different post;
  - record whether they publish with the image.
- **Metrics after launch:**
  - share of published posts that keep their generated image (against today's baseline,
    which needs PR #66 data);
  - picker completion rate;
  - share of users who change their style within 30 days (instability signal).

## 11. Build order (when unblocked) and owners

The tasks have disjoint file scopes so they can run in parallel.

| # | Piece | Owner | Depends on |
|---|---|---|---|
| 1 | `generateOpenAiImageEdit` + `IMAGE_TEXT_DETECTED` cause + check after generation + fix `ai-usage.ts` image-input price | contivo-llm-engineer / contivo-backend-developer (`lib/ai/image.ts`, `lib/ai-usage.ts`) | — |
| 2 | Look library + `imageStyle` in brand memory + prompt assembly + format sizes and crop | contivo-llm-engineer (`content-image-brief.ts`, `content-image.ts`) | — |
| 3 | Picker UI inside the first-post path + Settings → Images | contivo-frontend-developer, from contivo-ux-ui-designer's spec | first-post-path design |
| 4 | Text and carousel template renderer (own spec) | contivo-tech-lead → backend | — |
| 5 | `brand_assets` + object storage + upload, moderation, rights, deletion | contivo-database-engineer, contivo-devops-engineer, contivo-backend-developer | Q5, Q6, legal |
| 6 | Prompt import and references (Professional) | contivo-llm-engineer + frontend | 1, 2, 5 |
| 7 | Quotas and wallet capture for extra images | contivo-backend-developer | wallet v1 merged, `pricing-packages` merged |

Files this spec touches: none (docs only). When built, it touches no journey or onboarding file
except the single picker step that `first-post-path-cpo` assigns.

## 12. Open questions

### For Farjad

1. **Plan mapping.** The decision says Free / Paid / Professional. The catalogue has
   Free / Founder / Growth / Agency. Is "Professional" Agency only, or Growth + Agency?
   This spec assumes Agency only.
2. **Free images.** `plans.ts` gives Free **0** images per month. The decision note implies a
   monthly image count on Free. Which is it, and how many? Proposal: 4 per month, the 3 base
   looks, 1:1 only.
3. **The picker's place.** The picker comes after the first draft exists, inside the
   first-post path. Confirm this with the `first-post-path-cpo` design. Showing 6 pictures
   before the first draft is not possible, because there is no post to picture yet.
4. **"In the style of X".** Removing names still lets a description imitate a living artist's
   recognisable look (eval, case S6). Do we allow brand looks that imitate a named living
   artist when the name is removed? Proposal: no. The rewrite also strips "in the style of"
   descriptions that identify a living artist, and the UI says why.
5. **Exact-mode background removal.** Do we buy it (a vendor API, roughly $0.01–0.20 per
   image; unverified, ask contivo-finance-accounting-specialist) or run an open-source model in
   the render worker? Until one exists, Exact mode can only use the photo full-frame with a
   crop, not cut out.

### For the owners

| # | Question | Owner |
|---|---|---|
| 6 | Object storage choice (Railway bucket vs R2), the signed-URL pattern, cost at 100 assets × 20 MB × N workspaces | contivo-devops-engineer |
| 7 | Terms clause for user-supplied images (licence, warranty, takedown). Is a checkbox enough consent evidence for people shown in team photos (PIPEDA, GDPR for EU users)? Do Quebec rules apply (Law 25: images of people as personal information)? | contivo-legal-compliance-specialist |
| 8 | Privacy Policy: name OpenAI as the processor of uploaded images; say that images sent to OpenAI may be retained for abuse monitoring under its API terms | contivo-legal-compliance-specialist |
| 9 | Retention: how long a soft-deleted asset stays recoverable (proposal: 0, hard delete in 24 h); backup windows; whether generated images derived from a deleted reference must be deleted too (proposal: no, they are our output and contain no pixels of the reference) | contivo-data-governance-specialist |
| 10 | PII inventory entry for `brand_assets` (faces = personal data); the deletion job and its audit log | contivo-data-governance-specialist |
| 11 | Credits per extra image (proposal: 1) and whether the "your style" path costs more | contivo-monetization-specialist |
| 12 | Style-card drift eval: does text alone hold a custom look across 20 posts? About $2 | contivo-head-of-data |
| 13 | Eval on **real** uploads from 2–3 pilot or mentee brands (phone photos, small print, Persian brands): the eval used generated stand-ins | contivo-head-of-data |
| 14 | A second image provider for edits. Today the edits path has no fallback outside OpenAI (Gemini image has no quota on our key) | contivo-head-of-data |
