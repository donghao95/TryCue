import type { LiveSummary, PostStateView } from "@trycue/shared";

export const DEMO_TITLE = "30 岁新手爸妈装修避坑清单！住了半年后悔的 12 个点";
export const DEMO_BODY = `宝宝出生前我也跟风买了一堆东西，后来才发现很多真的用不上。

这篇只说我自己踩过的坑：太复杂的温奶器、颜值很高但不好清洗的奶瓶、过早买很大的婴儿床、一次性囤太多安抚玩具、太厚的包被、网红收纳架、功能重复的小电器、尺码囤太多的衣服。

我的建议是：先买基础款，少量试用，再根据宝宝和家庭习惯补。`;

export const emptyPostState: PostStateView = {
  exposureCount: 0,
  openCount: 0,
  likeCount: 0,
  favoriteCount: 0,
  commentCount: 0,
  shareCount: 0,
  exitCount: 0
};

export const emptySummary: LiveSummary = {
  audienceTotal: 0,
  reachedCount: 0,
  openedCount: 0,
  finishedCount: 0,
  skippedCount: 0,
  browsedAndLeftCount: 0,
  riskExitCount: 0,
  maxStepsCount: 0,
  likedCount: 0,
  favoritedCount: 0,
  commentedCount: 0,
  trustConcernCount: 0,
  adConcernCount: 0,
  questionCount: 0
};

export const SEAT_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "all" },
  { key: "active", label: "active" },
  { key: "opened", label: "opened" },
  { key: "commented", label: "commented" },
  { key: "favorited", label: "favorited" },
  { key: "skipped", label: "skipped" },
  { key: "doubt", label: "doubt" },
  { key: "finished", label: "finished" },
  { key: "failed", label: "failed" }
];

export const MAX_POST_IMAGES = 9;
export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_EDGE = 1600;
export const COMMENT_PAGE_SIZE = 20;
export const RUNTIME_LOG_PAGE_SIZE = 100;
export const SEEN_EVENT_IDS_MAX = 2000;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const DEMO_IMAGE_URLS = [
  "/uploads/demo-trycue-room.jpg",
  "/uploads/demo-trycue-detail.jpg",
  "/uploads/demo-trycue-list.jpg"
] as const;


