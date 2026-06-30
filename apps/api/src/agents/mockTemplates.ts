import type { ParsedToolCall } from "./types.js";
import type { AudienceDemographics } from "@trycue/shared/audience";

export const names = [
  "陈琳",
  "周雨",
  "林可",
  "何静",
  "小北",
  "阿宁",
  "Momo",
  "赵敏",
  "苏苏",
  "阿琪",
  "任禾",
  "洛洛",
  "姜然",
  "许一",
  "沈夏",
  "梁青",
  "杜若",
  "小满",
  "钟白",
  "秦安",
  "伊一",
  "温宁",
  "夏树",
  "顾遥",
  "唐晓",
  "谢南",
  "宁宁",
  "田田",
  "叶子",
  "阿甜"
];

type DemoAudienceTemplate = {
  segment: "核心用户" | "相邻用户" | "挑剔用户" | "路人用户";
  label: string;
  profile: string;
  personality: string;
  mbtiType: string;
  responseStyle: string;
  likelyActions: ParsedToolCall["toolName"][];
};

export const segmentMeta: Record<DemoAudienceTemplate["segment"], {
  groupBrief: string;
  groupTags: string[];
  diversityAxes: string[];
}> = {
  核心用户: {
    groupBrief: "正在准备或复盘宝宝用品采购，会把避坑清单当成真实决策资料。",
    groupTags: ["新手爸妈", "高意向", "囤货决策"],
    diversityAxes: ["预算压力", "家庭分工", "已有踩坑", "收藏动机"]
  },
  相邻用户: {
    groupBrief: "还没有强购买任务，但与备孕、亲友送礼或家庭规划相关，会先收藏或转发。",
    groupTags: ["潜在需求", "送礼参考", "提前收藏"],
    diversityAxes: ["需求距离", "转发对象", "未来使用", "轻互动"]
  },
  挑剔用户: {
    groupBrief: "对母婴消费和平台种草更警惕，会追问边界、来源和适用条件。",
    groupTags: ["高怀疑", "反软广", "边界条件"],
    diversityAxes: ["广告敏感", "过来人经验", "价格要求", "反驳倾向"]
  },
  路人用户: {
    groupBrief: "低相关或弱意向用户，用来展示快速跳出、只看热闹和沉默浏览。",
    groupTags: ["低意向", "快速退出", "弱相关"],
    diversityAxes: ["第一眼兴趣", "停留耐心", "评论意愿", "算法误推"]
  }
};

const demoAudienceTemplates: DemoAudienceTemplate[] = [
  {
    segment: "核心用户",
    label: "孕期囤货中的准妈妈",
    profile: "预产期还有两三个月，每天在内容社区看囤货清单，购物车里已经放了温奶器、奶瓶和婴儿床。",
    personality: "信任真实用过后的后悔清单，尤其看重为什么不好用、什么情况下才需要。对品牌官方推荐和过于整齐的种草评论会保留意见。",
    mbtiType: "ISFJ",
    responseStyle: "真诚请教型，评论会直接说自己购物车中招了，求更具体的替代方案。看到标题会立刻点开，边看边对照购物车，大概率收藏。",
    likelyActions: ["open_post", "favorite_post", "view_comments", "write_comment"]
  },
  {
    segment: "核心用户",
    label: "宝宝三个月的新手妈妈",
    profile: "宝宝刚满三个月，温奶器和大婴儿床都买了但用得很少，家里角落已经堆了不少闲置。",
    personality: "最信同月龄妈妈的真实反馈，已经对网红款祛魅。会看作者有没有说清楚家庭习惯和宝宝差异。",
    mbtiType: "ESFJ",
    responseStyle: "共鸣感强，语气像在评论区倒苦水，会说某个东西真的吃灰。会认真看完，对照自己踩过的坑频频点头。",
    likelyActions: ["open_post", "like_post", "favorite_post", "write_comment"]
  },
  {
    segment: "核心用户",
    label: "精打细算的二胎妈妈",
    profile: "大宝三岁了，现在怀二胎。一胎时买过很多网红用品，这次更关注少买、好清洗、真正高频。",
    personality: "有自己的判断体系，不会照单全收。信具体场景和反例，不喜欢一句话否定所有家庭的绝对结论。",
    mbtiType: "ISTJ",
    responseStyle: "过来人语气，评论会带一点复盘感，不会太激动。快速浏览自己没踩过的坑，看到认同处会点赞。",
    likelyActions: ["open_post", "like_post", "write_comment", "view_comments"]
  },
  {
    segment: "核心用户",
    label: "刚怀孕的信息焦虑用户",
    profile: "刚确认怀孕，面对宝宝用品清单有点慌，不知道哪些是必须买、哪些只是营销出来的需求。",
    personality: "容易依赖高赞经验，但也怕被焦虑营销带着走。会把清单、评论区补充和身边朋友建议放在一起看。",
    mbtiType: "INFP",
    responseStyle: "语气软一点，常说先收藏、慢慢研究、感谢分享。会逐条看完并收藏，评论不一定多。",
    likelyActions: ["open_post", "favorite_post", "view_comments"]
  },
  {
    segment: "核心用户",
    label: "老人带娃的职场妈妈",
    profile: "产假快结束了，之后白天主要由婆婆帮忙带娃。她不想买复杂小电器，怕老人不会用还增加沟通成本。",
    personality: "信任操作简单、动线清楚、老人也能独立使用的建议。对功能很多但步骤复杂的产品天然警惕。",
    mbtiType: "ESTJ",
    responseStyle: "问题具体，常问某个东西老人能不能用明白，语气务实。觉得有用会收藏，也可能转给伴侣一起确认。",
    likelyActions: ["open_post", "favorite_post", "share_post", "write_comment"]
  },
  {
    segment: "核心用户",
    label: "预算敏感的小城妈妈",
    profile: "在小城市生活，收入不算高，但宝宝用品又不敢太随便。她想把钱花在真正安全、高频、必要的东西上。",
    personality: "信真实价格、平替方案和不买理由。对越贵越安全的说法很警惕，也不喜欢只列高价品牌。",
    mbtiType: "ISTP",
    responseStyle: "语气直接又带点自嘲，会说省钱了、买不起但也不想乱买。会认真看完并收藏，遇到缺少替代方案时会追问。",
    likelyActions: ["open_post", "favorite_post", "write_comment", "like_post"]
  },
  {
    segment: "核心用户",
    label: "全职带娃的疲惫妈妈",
    profile: "全职在家带娃，当初孕期囤了很多东西，现在家里到处是用不上又舍不得扔的宝宝用品。",
    personality: "现在更信差评和后悔理由，觉得说不买什么比推荐买什么更有价值。会看评论区有没有同款闲置经历。",
    mbtiType: "ISFP",
    responseStyle: "情绪真实，像在评论区找同伴，会说心疼钱、家里吃灰。标题戳中后会点开，容易点赞收藏。",
    likelyActions: ["open_post", "like_post", "favorite_post", "write_comment"]
  },
  {
    segment: "核心用户",
    label: "夫妻共同决策的准妈妈",
    profile: "老公总说孩子不用那么多东西，但她看到别人都在买又不放心，需要一篇讲得清楚的避坑帖来一起讨论。",
    personality: "信任有原因、有场景、有取舍的内容，尤其能说明为什么少买不是亏待宝宝。",
    mbtiType: "ENFJ",
    responseStyle: "生活化，常提老公、队友、家庭群，语气带一点松口气。会收藏当论据，也会转发给伴侣看。",
    likelyActions: ["open_post", "favorite_post", "share_post", "view_comments"]
  },
  {
    segment: "相邻用户",
    label: "备孕中的提前收藏者",
    profile: "还在备孕阶段，暂时没有购买任务，但已经开始关注母婴内容，想提前建立一点常识。",
    personality: "判断力还比较弱，主要看内容是否讲得具体、评论区是否有真实补充。讨厌纯种草和制造焦虑。",
    mbtiType: "INFP",
    responseStyle: "轻声量用户，常说先码住、以后再看。会看完但不深度参与，大概率收藏。",
    likelyActions: ["open_post", "favorite_post", "view_comments"]
  },
  {
    segment: "相邻用户",
    label: "被派来做功课的准爸爸",
    profile: "老婆怀孕五个月，让他研究该买什么宝宝用品。他对品牌和型号没概念，只想快速知道哪些不用买。",
    personality: "信简单明了的结论和真实踩坑，不想看太长的术语。怕买错被念叨，也怕漏买关键用品。",
    mbtiType: "ESTP",
    responseStyle: "直接实用型，会说老婆让我来做功课、先转给她。快速扫重点，看到有用会收藏。",
    likelyActions: ["open_post", "share_post", "favorite_post"]
  },
  {
    segment: "相邻用户",
    label: "想送礼的朋友",
    profile: "闺蜜刚生了宝宝，她想送点实用东西，但又怕送了对方根本用不上。",
    personality: "信评论区真实反馈和明确适用场景。比起避坑本身，更想知道反向应该送什么。",
    mbtiType: "ENFP",
    responseStyle: "语气像向姐妹求助，会问送什么比较稳。会看评论区找推荐，可能留言问送礼建议。",
    likelyActions: ["open_post", "view_comments", "write_comment", "favorite_post"]
  },
  {
    segment: "相邻用户",
    label: "孩子已上幼儿园的回看妈妈",
    profile: "孩子已经上幼儿园了，偶尔刷到母婴内容会点进去看看，像是在回看当年被各种清单支配的自己。",
    personality: "已经有成熟经验，主要看内容是否说中了真实焦虑。不会再被种草，但会认可少买先试的观念。",
    mbtiType: "ESFP",
    responseStyle: "过来人语气，轻松、有点感慨，会说早知道就好了。会点开找共鸣，看到熟悉的坑可能点赞。",
    likelyActions: ["open_post", "like_post", "write_comment"]
  },
  {
    segment: "挑剔用户",
    label: "广告敏感的老网民",
    profile: "刷内容社区多年，见过太多先避坑再带货的套路。看到爆款清单会先翻评论区和主页。",
    personality: "更信评论区真实争议，不太信正文里的单方经验。若看到统一口径评论或诱导私信，会立即怀疑。",
    mbtiType: "INTP",
    responseStyle: "轻微质疑，不攻击人，会问是不是有广、评论区是不是太整齐。会点开但主要看评论区。",
    likelyActions: ["open_post", "view_comments", "write_comment", "exit_browsing"]
  },
  {
    segment: "挑剔用户",
    label: "科学育儿派",
    profile: "平时关注儿科医生和专业母婴博主，习惯区分经验分享和普适建议。",
    personality: "信有边界、有条件、有反例的表达。对所有家庭都适用的绝对化判断会保留意见。",
    mbtiType: "INTJ",
    responseStyle: "克制理性，常说看情况、不能一概而论。会快速看完，若发现表述太满会评论补充边界。",
    likelyActions: ["open_post", "write_comment", "exit_browsing"]
  },
  {
    segment: "挑剔用户",
    label: "温奶器真实使用者",
    profile: "宝宝夜奶频繁，家里温奶器一直在用。她觉得有些东西不能一棍子打死，关键看喂养方式。",
    personality: "信自己的真实使用场景，也认可别人闲置的可能。反感不区分家庭情况的避坑结论。",
    mbtiType: "ISTP",
    responseStyle: "不是吵架语气，但会直接说自家情况不同，提醒别人别照单全收。会点开看博主怎么说。",
    likelyActions: ["open_post", "write_comment", "view_comments", "like_comment"]
  },
  {
    segment: "挑剔用户",
    label: "消费主义反思者",
    profile: "一直对母婴行业制造焦虑很敏感，看到避坑帖会思考它是在减少消费还是制造新的清单焦虑。",
    personality: "信真诚复盘和少买先试的价值观，但对任何隐性带货或过度制造恐慌的表达都敏感。",
    mbtiType: "INFJ",
    responseStyle: "评论稍长一点，像普通用户的观点输出，不像专业报告。会认真看完，可能留下观点型评论。",
    likelyActions: ["open_post", "write_comment", "view_comments", "share_post"]
  },
  {
    segment: "挑剔用户",
    label: "比价平替党",
    profile: "买东西前一定会比价，看避坑帖时最想知道不买这些之后应该怎么替代。",
    personality: "信价格区间、平替方案和真实使用成本。只说别买但不给替代路径，会觉得帮助有限。",
    mbtiType: "ESTJ",
    responseStyle: "务实直接，会问那到底买啥、有没有便宜好用的替代。会看完并追问平替方案。",
    likelyActions: ["open_post", "write_comment", "view_comments", "favorite_post"]
  },
  {
    segment: "路人用户",
    label: "随便刷刷的上班族",
    profile: "单身上班族，午休随便刷内容社区，点进来只是因为标题有后悔和避坑两个关键词。",
    personality: "没有真实决策场景，只凭内容是否有趣决定停留。对母婴用品没有判断基础。",
    mbtiType: "ESTP",
    responseStyle: "很少评论，若评论也是一句感叹式的路人反馈。可能点开看几眼，发现离自己太远就退出。",
    likelyActions: ["open_post", "exit_browsing"]
  },
  {
    segment: "路人用户",
    label: "被算法推来的大学生",
    profile: "平时看穿搭和校园生活，不知道为什么刷到这篇。对宝宝用品没有需求，但会被养娃成本震住。",
    personality: "不判断内容专业性，只看情绪感受。觉得养娃好复杂、花钱好多。",
    mbtiType: "ESFP",
    responseStyle: "如果评论，会是短句感叹，比如看完更不敢生了。看标题或前几句就可能退出。",
    likelyActions: ["open_post", "exit_browsing"]
  },
  {
    segment: "路人用户",
    label: "数码内容误入用户",
    profile: "平时刷数码和游戏内容，对宝宝用品完全无感。看到标题后觉得和自己关系不大。",
    personality: "没有母婴消费场景，也不会建立信任或质疑，只判断是不是和自己相关。",
    mbtiType: "ISTP",
    responseStyle: "基本不评论，心路历程只有和我没关系、先走了。大概率信息流直接划走。",
    likelyActions: ["exit_browsing"]
  }
];

export const demoCommentPools = {
  question: [
    "奶瓶到底哪个牌子好清洗啊，求推荐",
    "安抚玩具是真的没必要提前买吗？我购物车里已经放了好几个",
    "婴儿床买多大的合适？是不是拼接床更实用",
    "包被南方冬天需要买厚的吗，完全没概念",
    "温奶器不用的话，半夜热奶怎么弄比较方便",
    "网红收纳架不好用的话，宝宝小件东西怎么收纳呀",
    "功能重复小电器具体指哪些？我怕买重了",
    "衣服每个阶段囤几套够换洗？不想买太多",
    "能不能出一版真正实用的基础款清单",
    "这些坑是买之前能看出来，还是只能用过才知道"
  ],
  doubt: [
    "感觉这个清单有点绝对，温奶器对夜奶家庭还是挺有用的",
    "每个宝宝情况不一样吧，有些东西别人闲置不代表我家也闲置",
    "博主后面不会开始推荐链接吧，先观望一下",
    "评论区怎么全在问链接，有点像广",
    "只说别买但不说替代方案，也有点难操作",
    "婴儿床这个要看户型吧，大一点也不是完全没道理",
    "有些东西虽然用得短，但那段时间真的省心",
    "真实分享可以，但别把个人经验说成所有人都适用"
  ],
  resonance: [
    "温奶器真的踩雷了，我家用了两次就吃灰",
    "一次性囤安抚玩具太真实了，最后宝宝只爱啃手",
    "衣服囤太多真的会哭，好多吊牌没拆就小了",
    "网红收纳架我也买了，拿东西一点都不顺手",
    "厚包被那个太对了，宝宝热得直哭",
    "功能重复小电器说的就是我家厨房",
    "看完感觉自己就是大冤种，条条都中",
    "早看到这个就好了，已经买了一堆闲置"
  ],
  experience: [
    "补充一个，推车别买太重，一个人带娃出门真的崩溃",
    "我家纯奶粉喂养，温奶器反而用得很多，还是看场景",
    "安抚玩具建议先买一两个试试，宝宝真的很挑",
    "衣服可以少买点，亲戚朋友送的也会很多",
    "婴儿床我家最后变杂物架了，拼接床更实用",
    "透明收纳箱比网红架子好用，便宜还一眼看到",
    "辅食工具真的可以等开始吃辅食再买，不急",
    "新手爸妈别太焦虑，很多东西用不上不是你不会带娃"
  ],
  lowIntent: [
    "先码住，以后用得上再看",
    "看看热闹，养娃真的好花钱",
    "转给我朋友了，她刚好怀孕",
    "已阅，感觉好复杂",
    "虽然没娃，但看完有点被劝退",
    "收藏了但希望暂时用不上"
  ]
} as const;

type DemoTemplateAllocation = {
  segment: DemoAudienceTemplate["segment"];
  items: Array<{ template: DemoAudienceTemplate; templateIndex: number; cycle: number }>;
};

export const segmentOrder: DemoAudienceTemplate["segment"][] = ["核心用户", "相邻用户", "挑剔用户", "路人用户"];

const segmentRatios: Record<DemoAudienceTemplate["segment"], number> = {
  核心用户: 0.4,
  相邻用户: 0.25,
  挑剔用户: 0.2,
  路人用户: 0.15
};

export function allocateDemoTemplateGroups(total: number): DemoTemplateAllocation[] {
  if (total <= 0) return [];
  const normalizedTotal = Math.floor(total);
  if (normalizedTotal <= segmentOrder.length) {
    return segmentOrder.slice(0, normalizedTotal).map((segment) => ({
      segment,
      items: pickDemoTemplatesForSegment(segment, 1)
    }));
  }

  const counts = segmentOrder.map((segment) => Math.max(1, Math.floor(normalizedTotal * segmentRatios[segment])));
  let assigned = counts.reduce((sum, count) => sum + count, 0);
  let index = 0;
  while (assigned < normalizedTotal) {
    counts[index % counts.length]! += 1;
    assigned += 1;
    index += 1;
  }
  while (assigned > normalizedTotal) {
    const targetIndex = findLastRemovableCountIndex(counts);
    if (targetIndex < 0) break;
    counts[targetIndex]! -= 1;
    assigned -= 1;
  }
  return counts
    .map((count, segmentIndex) => {
      const segment = segmentOrder[segmentIndex]!;
      return { segment, items: pickDemoTemplatesForSegment(segment, count) };
    })
    .filter((item) => item.items.length > 0);
}

function findLastRemovableCountIndex(counts: number[]) {
  for (let index = counts.length - 1; index >= 0; index -= 1) {
    if ((counts[index] ?? 0) > 1) return index;
  }
  return -1;
}

export function pickDemoTemplatesForSegment(segment: DemoAudienceTemplate["segment"], count: number) {
  const pool = demoAudienceTemplates
    .map((template, templateIndex) => ({ template, templateIndex }))
    .filter((item) => item.template.segment === segment);
  return Array.from({ length: count }, (_, index) => {
    const item = pick(pool, index);
    return {
      template: item.template,
      templateIndex: item.templateIndex,
      cycle: Math.floor(index / pool.length)
    };
  });
}

export function shortContentSignal(value: string, fallback: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}...` : cleaned;
}

export function contentClaimSignal(bodyText: string) {
  const candidates = ["先买基础款", "少量试用", "12 个坑", "12个坑", "住了半年"];
  const hit = candidates.find((candidate) => bodyText.includes(candidate));
  return hit ? `「${hit}」` : "核心建议";
}

export function mockBackgroundForDemographics(demographics: AudienceDemographics) {
  const role = demographics.role || "普通用户";
  const lifeStage = demographics.lifeStage || "日常阶段";
  const cityTier = demographics.cityTier || "不限定城市";
  if (role.includes("爸爸") || role.includes("伴侣")) {
    return `他在${cityTier}有稳定工作，家庭生活正在围绕${lifeStage}重新分配时间和预算。`;
  }
  if (role.includes("妈妈") || role.includes("准妈妈")) {
    return `她在${cityTier}维持着相对规律的家庭生活，近期的生活重心围绕${lifeStage}展开。`;
  }
  return `这个人生活节奏稳定，近期处在${lifeStage}，日常消费会受到家庭计划和现实预算影响。`;
}

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function mockDemographics(segment: DemoAudienceTemplate["segment"], index: number): AudienceDemographics {
  const roles: Record<DemoAudienceTemplate["segment"], string[]> = {
    核心用户: ["准妈妈", "新手妈妈", "准爸爸"],
    相邻用户: ["备孕用户", "伴侣", "送礼者"],
    挑剔用户: ["新手妈妈", "专业从业者", "长辈"],
    路人用户: ["路人用户", "普通用户", "学生"]
  };
  const lifeStages: Record<DemoAudienceTemplate["segment"], string[]> = {
    核心用户: ["孕晚期", "产后3个月", "备孕期"],
    相邻用户: ["备孕期", "孕中期", "送礼准备"],
    挑剔用户: ["带娃1年", "育儿观察期", "经验复盘期"],
    路人用户: ["不限定", "单身阶段", "泛浏览"]
  };
  const spending = ["预算敏感", "中等", "愿为省心付费"];
  return {
    gender: "不限定",
    ageRange: pick(["24-30岁", "28-35岁", "30-38岁"], index),
    cityTier: pick(["一线城市", "二线城市", "三线城市"], index),
    lifeStage: pick(lifeStages[segment], index),
    role: pick(roles[segment], index),
    spendingPower: pick(spending, index)
  };
}

export function defaultDemographics(value: string): AudienceDemographics {
  return {
    gender: value,
    ageRange: value,
    cityTier: value,
    lifeStage: value,
    role: value,
    spendingPower: value
  };
}

export function pick<T>(items: readonly T[], index: number): T {
  return items[((index % items.length) + items.length) % items.length]!;
}
