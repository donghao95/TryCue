import type {
  AgentProvider,
  ParsedToolCall,
  AudienceSamplingDirectiveView,
  AudienceSamplingPlanViewForProvider,
  RunParticipantContext,
  GeneratedAudience
} from "./types.js";
import type {
  AudienceDemographics,
  AudienceGenerationProgressView,
  AudienceProfileExpansionFrame,
  AudienceSamplingPlanRevisionMessage,
  AudienceSamplingPlanRevisionProposal,
  AudienceSeatRevisionMessage,
  AudienceSeatRevisionProposal
} from "@trycue/shared/audience";
import type {
  CommentIntent,
  ExitReasonCategory,
  ExitReadingDepth,
  InterestTrustLevel,
  ReadDepth
} from "@trycue/shared/tool";
import { prisma } from "@trycue/db";
import type { StepResult, ToolSet } from "ai";
import {
  completeAiSdkStepAndPrepareNext,
  executeAiSdkPlannedToolCall,
  persistStep
} from "../tools/toolExecutor.js";
import { ALL_TOOLS, loadJourneyTranscript, renderSessionMessages } from "../runtime/agentSessions.js";
import { PROMPT_VERSION_AGENT } from "./promptVersions.js";

function delay(minMs: number, maxMs: number): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") return Promise.resolve();
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const names = [
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

const segmentMeta: Record<DemoAudienceTemplate["segment"], {
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

const demoCommentPools = {
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

export class MockAgentProvider implements AgentProvider {
  async generateAudienceSamplingPlan(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    count: number;
  }) {
    await delay(1200, 1800);
    const allocations = allocateDemoTemplateGroups(input.count);
    const directives = allocations.map(({ segment, items }) => {
      const meta = segmentMeta[segment];
      const rationale = segment === "核心用户"
        ? "核心高需求人群决定收藏、追问和真实转化信号，是试映的基本盘。重点观察是否收藏、追问型号价格、补充真实经验。"
        : segment === "相邻用户"
          ? "相邻潜在人群用来观察内容是否能触达非即时购买者。重点观察是否先收藏、转发给相关亲友或轻量浏览。"
          : segment === "挑剔用户"
            ? "挑剔和怀疑用户会暴露广告感、证据缺口和边界表达问题。重点观察是否质疑广告感、要求证据或指出适用边界。"
            : "低意向路人用于校准误触、秒退和弱相关场景。重点观察是否快速退出、沉默浏览或只留下低意向感叹。";
      return {
        name: segment,
        description: meta.groupBrief,
        quantity: items.length,
        diversityAxes: meta.diversityAxes,
        rationale
      };
    });
    const planSubject = shortContentSignal(input.title, "宝宝用品避坑清单");
    const planClaim = contentClaimSignal(input.bodyText);
    return {
      totalCount: input.count,
      planMarkdown: `这份采样计划把「${planSubject}」理解为一场发布前试映。

重点看${planClaim}这类建议是否像真实经验，而不是泛泛种草。

观众按准备购买、刚踩坑、谨慎质疑和低相关浏览拉开经验距离。

确认后，人设和试映证据会围绕收藏追问、经验补充、评论反驳和退出浏览展开。`,
      dimensions: ["需求强度", "内容相关度", "信任阈值", "广告敏感度", "预算压力", "互动倾向"],
      directives
    };
  }

  async generateAudienceSamplingPlanRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    messages: AudienceSamplingPlanRevisionMessage[];
  }): Promise<AudienceSamplingPlanRevisionProposal> {
    await delay(350, 650);
    const latest = input.messages.at(-1)?.visibleText ?? "";
    const directive = input.plan.directives[0];
    if (!directive) {
      return {
        summary: "当前还没有可调整的人群分组，建议先重新生成采样计划。",
        operations: [],
        warnings: ["没有可引用的分组，不能生成可应用建议。"]
      };
    }
    if (latest.includes("删") && input.plan.directives.length > 1) {
      const target = input.plan.directives.at(-1)!;
      return {
        summary: `建议删除「${target.name}」，保留更相关的人群分组。`,
        operations: [{
          operationId: "mock_delete_directive_1",
          op: "delete_directive",
          directiveId: target.id,
          reason: "用户表达了删减低价值分组的意图，mock 选择最后一组作为删除建议。"
        }],
        totalCountChange: { before: input.plan.totalCount, after: input.plan.totalCount - target.quantity },
        warnings: []
      };
    }
    const wantsSplit = /拆|分出|调出|保持.*总|总.*不变/.test(latest);
    const splitCount = 1;
    const nextCoreCount = Math.max(1, directive.quantity - splitCount);
    const addedDirective = {
      name: "预算敏感用户",
      description: `从${directive.description}中补充的强需求但价格敏感用户，会重点质疑清单是否过度消费。`,
      quantity: splitCount,
      diversityAxes: ["预算极紧", "替代品比较", "家庭共同决策"],
      rationale: "单独观察这类用户是否追问价格、替代品和真实必要性。"
    };
    if (!wantsSplit) {
      return {
        summary: "建议新增一组预算敏感用户，并让当前计划总人数随新增分组增加。",
        operations: [{
          operationId: "mock_add_directive_1",
          op: "add_directive",
          directive: addedDirective,
          reason: "用户希望补充预算敏感视角；新增人群默认增加实时总人数，不从原分组扣减。"
        }],
        totalCountChange: { before: input.plan.totalCount, after: input.plan.totalCount + splitCount },
        warnings: []
      };
    }
    return {
      summary: `建议从「${directive.name}」中拆出一组预算敏感用户，并相应下调原分组人数。`,
      operations: [
        {
          operationId: "mock_add_directive_1",
          op: "add_directive",
          directive: {
            ...addedDirective,
            description: `从${directive.description}中拆出的强需求但价格敏感用户，会重点质疑清单是否过度消费。`
          },
          reason: "用户希望补充或拆出预算敏感视角。"
        },
        {
          operationId: "mock_update_directive_1",
          op: "update_directive",
          directiveId: directive.id,
          patch: { quantity: nextCoreCount },
          before: { quantity: directive.quantity },
          reason: "新增预算敏感组后，原分组保留非极端预算压力的用户。"
        }
      ],
      totalCountChange: { before: input.plan.totalCount, after: input.plan.totalCount },
      warnings: []
    };
  }

  async generateAudienceSeatRevision(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider | null;
    progress: AudienceGenerationProgressView;
    messages: AudienceSeatRevisionMessage[];
  }): Promise<AudienceSeatRevisionProposal> {
    await delay(350, 650);
    const latest = input.messages.at(-1)?.visibleText ?? "";
    const profile = input.progress.profiles.find((item) => item.identityStatus === "identity_ready") ?? input.progress.profiles[0];
    if (!profile) {
      return {
        summary: "当前还没有可打磨的观众结果。",
        operations: [],
        warnings: ["观众身份尚未生成，不能生成可应用建议。"]
      };
    }
    if (/新增|增加|多加|补充/.test(latest)) {
      const planDirective = input.plan?.directives[0];
      const progressDirective = input.progress.directives[0];
      const directiveId = planDirective?.id ?? progressDirective?.directiveId;
      const directiveLabel = planDirective?.name ?? progressDirective?.description ?? "目标分组";
      if (!directiveId) {
        return {
          summary: "当前缺少可承载新增观众的分组。",
          operations: [],
          warnings: ["需要先有已确认的人群分组。"]
        };
      }
      return {
        summary: `建议在「${directiveLabel}」下新增 1 位预算敏感观众。`,
        operations: [{
          operationId: "mock_add_profile_1",
          op: "add_profile",
          directiveId,
          samplingLabel: "预算敏感补充观众",
          demographics: defaultDemographics("不限定"),
                reason: "用户表达了新增观众的意图，mock 建议直接增加一个具体观众结果。"
        }],
        warnings: []
      };
    }
    if (latest.includes("删")) {
      return {
        summary: `建议删除「${profile.samplingLabel}」，用于清理不合适的结果层观众。`,
        operations: [{
          operationId: "mock_delete_profile_1",
          op: "delete_profile",
          profileId: profile.id,
          reason: "用户表达了删除具体观众的意图。"
        }],
        warnings: []
      };
    }
    if (latest.includes("重生") || latest.includes("重新")) {
      return {
        summary: `建议重生「${profile.samplingLabel}」的人设，让同组表达更有差异。`,
        operations: [{
          operationId: "mock_regenerate_identity_1",
          op: "regenerate_identity",
          profileId: profile.id,
          reason: "用户希望拉开同组观众差异。"
        }],
        warnings: []
      };
    }
    const currentPersona = profile.identity?.personaJson && typeof profile.identity.personaJson === "object"
      ? profile.identity.personaJson as Record<string, unknown>
      : {};
    return {
      summary: `建议把「${profile.samplingLabel}」调整成更理性、重证据的观众。`,
      operations: [{
        operationId: "mock_update_identity_1",
        op: "update_identity",
        profileId: profile.id,
        patch: {
          personaJson: {
            profile: String(currentPersona.profile ?? profile.samplingLabel),
            personality: "更依赖价格、型号、真实使用证据和评论区补充信息，不会只因为清单完整就信任。",
            mbtiType: "INTJ",
            responseStyle: "表达克制直接，会用具体问题指出预算和证据缺口。倾向先看评论和细节，再决定是否收藏。"
          }
        },
        before: currentPersona,
        reason: "用户希望该观众更理性，并和同组其他观众拉开。"
      }],
      warnings: []
    };
  }

  async expandAudienceProfiles(input: {
    title: string;
    coverImageUrl: string;
    imageUrls: string[];
    bodyText: string;
    plan: AudienceSamplingPlanViewForProvider;
    directive: AudienceSamplingDirectiveView;
    chunkStart: number;
    chunkCount: number;
    onFrame: (frame: AudienceProfileExpansionFrame) => void | Promise<void>;
  }): Promise<void> {
    await delay(650, 950);
    const chunkStart = input.chunkStart;
    const chunkCount = input.chunkCount;
    const segment = segmentOrder.find((item) => input.directive.description.includes(item)) ?? "核心用户";
    const items = pickDemoTemplatesForSegment(segment, chunkStart + chunkCount).slice(chunkStart);
    for (const [index, { template, cycle }] of items.entries()) {
      const sampleIndex = chunkStart + index;
      const label = cycle > 0 ? `${template.label} ${cycle + 1}` : template.label;
      const profile = {
        samplingLabel: label,
        demographics: mockDemographics(template.segment, sampleIndex)
      };
      await input.onFrame({
        type: "profile_completed",
        sampleIndex,
        profile: { samplingLabel: label, demographics: profile.demographics as { gender: string; ageRange: string; cityTier: string; lifeStage: string; role: string; spendingPower: string } }
      });
    }
  }

  async generateAudiencePersona(input: {
    profile: {
      profileId: string;
      demographics: Record<string, unknown>;
    };
    platformName?: string;
  }): Promise<GeneratedAudience> {
    await delay(550, 850);
    const hash = hashString(input.profile.profileId ?? "");
    const displayName = names[hash % names.length]!;
    const demographics = input.profile.demographics as Record<string, string>;
    const role = demographics.role ?? "用户";
    const lifeStage = demographics.lifeStage ?? "";
    const spendingPower = demographics.spendingPower ?? "";
    const ageRange = demographics.ageRange ?? "不限定年龄";
    const cityTier = demographics.cityTier ?? "不限定城市";
    const gender = demographics.gender ?? "不限定";
    const background = mockBackgroundForDemographics({ ...demographics, gender, role, lifeStage, spendingPower, ageRange, cityTier });
    return {
      profileId: input.profile.profileId,
      displayName,
      persona: {
        profile: `${displayName}是一位${ageRange}的${role}，生活在${cityTier}，目前处于${lifeStage || "普通生活阶段"}。${background}长期消费习惯偏${spendingPower || "中等"}，做决定时会结合家庭节奏、过往经验和可承受成本。`,
        personality: "谨慎务实，会结合自身阶段、预算和真实评论判断可信度。",
        mbtiType: "ISFJ",
        responseStyle: "表达口语化，像真实用户的即时反馈，会围绕自己的具体疑问展开。会先看标题和正文结构，再决定是否点开评论、收藏或退出。"
      }
    };
  }

  async runAudienceTurn(context: RunParticipantContext) {
    const model = "mock-audience-agent";
    const promptVersion = PROMPT_VERSION_AGENT;
    if (!context.maxSteps) throw new Error("runAudienceTurn: maxSteps is required");
    const maxSteps = context.maxSteps;
    let currentContext = context;
    let currentActionId = context.actionId;
    let thoughtText = "";
    const executedSteps: Array<{ actionId: string; step: StepResult<ToolSet>; toolCalls: ParsedToolCall[] }> = [];

    for (let guard = context.stepIndex; guard < maxSteps; guard += 1) {
      await delay(1500, 3000);
      // 使用 participantId 的稳定 hash 叠加 stepIndex 作为 indexHint，
      // 避免 UUID 数字末位带来的随机性；同一观众同一 stepIndex 行为可复现，
      // 不同 stepIndex 仍有变化以覆盖 read_post / like_comment / write_comment 等分支
      const indexHint = hashString(currentContext.participantId) + currentContext.stepIndex;
      const forceFeedOnlyExit = currentContext.stepIndex === 0
        ? await isDeterministicFeedOnlyExitParticipant(currentContext.runId, currentContext.participantId)
        : false;
      const toolCalls = enrichMockToolCalls(planMockTools(currentContext, indexHint, forceFeedOnlyExit), currentContext);
      thoughtText = buildThought(currentContext, toolCalls);
      const enrichedToolCalls = toolCalls.map((call, index) => enrichMockToolCall(currentContext, currentActionId, call, index));

      for (const call of enrichedToolCalls) {
        await executeAiSdkPlannedToolCall(currentActionId, {
          toolName: call.toolName,
          callIndex: call.callIndex ?? 0,
          sdkCallId: call.sdkCallId,
          idempotencyKey: call.idempotencyKey ?? idempotencyKeyForMock(currentContext, currentActionId, call.callIndex ?? 0),
          args: call.args,
          rawToolCall: call.rawToolCall
        });
      }

      const step = mockStepResult(model, thoughtText, enrichedToolCalls, currentContext);
      await persistStep(currentActionId, step, { promptVersion });
      executedSteps.push({ actionId: currentActionId, step, toolCalls: enrichedToolCalls });

      const nextTurnId = await completeAiSdkStepAndPrepareNext(currentActionId, step, maxSteps);
      if (!nextTurnId) break;
      const nextContext = await contextForNextMockTurn(currentContext, nextTurnId);
      if (!nextContext) break;
      currentContext = nextContext;
      currentActionId = nextTurnId;
    }

    const requestPayload: Record<string, unknown> = {
      model,
      messages: context.messages,
      hasOpenedPost: context.hasOpenedPost,
      stepIndex: context.stepIndex,
      maxSteps
    };

    const rawResponse: Record<string, unknown> = {
      provider: "mock",
      model,
      steps: executedSteps.map(({ actionId, toolCalls }) => ({ actionId, toolCalls }))
    };

    const allToolCalls = executedSteps.flatMap((step) => step.toolCalls);

    return {
      thoughtText,
      toolCalls: allToolCalls,
      managedRuntime: true,
      rawOutput: {
        provider: "mock",
        stepIndex: context.stepIndex,
        hasOpenedPost: context.hasOpenedPost,
        toolCalls: allToolCalls
      },
      model,
      promptVersion,
      requestJson: requestPayload,
      rawResponseJson: rawResponse,
      parsedToolCallsJson: allToolCalls
    };
  }
}

type DemoTemplateAllocation = {
  segment: DemoAudienceTemplate["segment"];
  items: Array<{ template: DemoAudienceTemplate; templateIndex: number; cycle: number }>;
};

const segmentOrder: DemoAudienceTemplate["segment"][] = ["核心用户", "相邻用户", "挑剔用户", "路人用户"];

const segmentRatios: Record<DemoAudienceTemplate["segment"], number> = {
  核心用户: 0.4,
  相邻用户: 0.25,
  挑剔用户: 0.2,
  路人用户: 0.15
};

function allocateDemoTemplateGroups(total: number): DemoTemplateAllocation[] {
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

function pickDemoTemplatesForSegment(segment: DemoAudienceTemplate["segment"], count: number) {
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

function shortContentSignal(value: string, fallback: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 24 ? `${cleaned.slice(0, 24)}...` : cleaned;
}

function contentClaimSignal(bodyText: string) {
  const candidates = ["先买基础款", "少量试用", "12 个坑", "12个坑", "住了半年"];
  const hit = candidates.find((candidate) => bodyText.includes(candidate));
  return hit ? `「${hit}」` : "核心建议";
}

function mockBackgroundForDemographics(demographics: AudienceDemographics) {
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

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function mockDemographics(segment: DemoAudienceTemplate["segment"], index: number): AudienceDemographics {
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

function defaultDemographics(value: string): AudienceDemographics {
  return {
    gender: value,
    ageRange: value,
    cityTier: value,
    lifeStage: value,
    role: value,
    spendingPower: value
  };
}

function pick<T>(items: readonly T[], index: number): T {
  return items[((index % items.length) + items.length) % items.length]!;
}

function enrichMockToolCalls(calls: ParsedToolCall[], context: RunParticipantContext): ParsedToolCall[] {
  const postId = postIdFromTranscript(context);
  return calls.map((call) => {
    const args = { ...call.args };
    if (postId && requiresPostId(call.toolName)) args.postId = postId;
    return { ...call, args };
  });
}

function enrichMockToolCall(
  context: RunParticipantContext,
  actionId: string,
  call: ParsedToolCall,
  callIndex: number
): ParsedToolCall {
  const sdkCallId = call.sdkCallId ?? `mock_call_${context.stepIndex}_${callIndex}`;
  const idempotencyKey = idempotencyKeyForMock(context, actionId, callIndex);
  return {
    ...call,
    sdkCallId,
    callIndex,
    idempotencyKey,
    rawToolCall: {
      id: sdkCallId,
      type: "function",
      function: {
        name: call.toolName,
        arguments: JSON.stringify(call.args)
      }
    }
  };
}

function idempotencyKeyForMock(context: RunParticipantContext, actionId: string, callIndex: number) {
  return `${context.runId}:${context.participantId}:${actionId}:${callIndex}`;
}

function requiresPostId(toolName: ParsedToolCall["toolName"]) {
  return toolName === "read_post"
    || toolName === "view_comments"
    || toolName === "like_post"
    || toolName === "favorite_post"
    || toolName === "share_post"
    || toolName === "write_comment";
}

function postIdFromTranscript(context: RunParticipantContext) {
  for (const message of [...context.messages].reverse()) {
    if (message.role !== "tool") continue;
    const content = message.content as unknown[];
    const resultPart = content.find(isToolResultWithOutput);
    if (!resultPart) continue;
    const output = toolResultOutputValue(resultPart.output);
    const result = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
    const postId = typeof result.postId === "string" ? result.postId.trim() : "";
    if (postId) return postId;
  }
  return null;
}

function isToolResultWithOutput(part: unknown): part is JsonToolResultPart {
  const record = part && typeof part === "object" ? part as Record<string, unknown> : {};
  return record.type === "tool-result" && "output" in record;
}

function mockStepResult(
  model: string,
  thoughtText: string,
  toolCalls: ParsedToolCall[],
  context: RunParticipantContext
): StepResult<ToolSet> {
  const aiSdkToolCalls = toolCalls.map((call) => ({
    type: "tool-call",
    toolCallId: call.sdkCallId,
    toolName: call.toolName,
    input: call.args
  }));
  return {
    text: thoughtText,
    reasoningText: undefined,
    toolCalls: aiSdkToolCalls,
    finishReason: toolCalls.length ? "tool-calls" : "stop",
    rawFinishReason: toolCalls.length ? "tool-calls" : "stop",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    request: {
      body: {
        provider: "mock",
        model,
        actionId: context.actionId,
        stepIndex: context.stepIndex,
        messages: context.messages
      }
    },
    response: {
      body: {
        provider: "mock",
        model,
        text: thoughtText,
        toolCalls
      }
    },
    model: { modelId: model }
  } as unknown as StepResult<ToolSet>;
}

async function contextForNextMockTurn(
  previous: RunParticipantContext,
  nextTurnId: string
): Promise<RunParticipantContext | null> {
  const turn = await prisma.agentTurn.findUnique({ where: { id: nextTurnId } });
  if (!turn?.journeyId) return null;
  const items = await loadJourneyTranscript(prisma, turn.journeyId);
  // Re-derive hasOpenedPost from DB: open_post interaction event is committed by the previous turn.
  const openPostEvent = await prisma.socialInteractionEvent.findFirst({
    where: {
      journeyId: turn.journeyId,
      interactionType: "open_post"
    },
    select: { id: true }
  });
  return {
    ...previous,
    actionId: turn.id,
    stepIndex: turn.stepIndex,
    journeyId: turn.journeyId,
    hasOpenedPost: previous.hasOpenedPost || !!openPostEvent,
    messages: await renderSessionMessages(items),
    availableTools: ALL_TOOLS
  };
}

export function planMockTools(context: RunParticipantContext, indexHint: number, forceFeedOnlyExit = false): ParsedToolCall[] {
  if (!context.hasOpenedPost) {
    if (context.stepIndex === 0 && (forceFeedOnlyExit || indexHint % 5 === 0)) {
      return [mockExit("not_relevant", "feed_only", "low", "low")];
    }
    return [{ toolName: "open_post", args: {} }];
  }

  if (context.hasOpenedPost) {
    const firstVisibleCommentId = firstCommentIdFromTranscript(context);
    if (context.stepIndex >= 3) return [mockExit("no_more_action", "skimmed", "low", "medium")];
    // ~20%: read and leave without interaction (read_post → exit)
    if (indexHint % 5 === 3) {
      const depth: ReadDepth = indexHint % 3 === 0 ? "skim" : indexHint % 3 === 1 ? "partial" : "full";
      // Vary risk exit reasons across participants
      const reason: ExitReasonCategory =
        depth === "skim" ? "not_interested"
        : depth === "partial" ? (indexHint % 2 === 0 ? "low_trust" : "too_ad_like")
        : (indexHint % 2 === 0 ? "finished_normally" : "need_more_evidence");
      const trust: InterestTrustLevel = reason === "low_trust" || reason === "too_ad_like" || reason === "need_more_evidence" ? "low" : "medium";
      return [mockReadPost(depth), mockExit(reason, depthToExitDepth(depth), "low", trust)];
    }
    if (indexHint % 5 === 0 && firstVisibleCommentId) {
      return [
        { toolName: "like_comment", args: { commentId: firstVisibleCommentId } },
        mockExit("finished_normally", "partial", "medium", "high")
      ];
    }
    if (indexHint % 3 === 0 && firstVisibleCommentId) {
      return [
        mockWriteComment("doubt", indexHint, firstVisibleCommentId),
        mockExit("finished_normally", "partial", "medium", "medium")
      ];
    }
    const calls: ParsedToolCall[] = [];
    // read_post before interacting (not everyone — ~67% read first)
    if (indexHint % 3 !== 1) calls.push(mockReadPost(indexHint % 2 === 0 ? "partial" : "full"));
    if (indexHint % 5 === 2) calls.push({ toolName: "share_post", args: {} });
    if (indexHint % 2 === 0) calls.push({ toolName: "favorite_post", args: {} });
    if (indexHint % 3 === 0) calls.push({ toolName: "like_post", args: {} });
    if (indexHint % 4 !== 1) calls.push({ toolName: "view_comments", args: { cursor: null } });
    if (indexHint % 4 === 1) calls.push(mockWriteComment(mockCommentForIndex(indexHint), indexHint, null));
    if (context.stepIndex >= 2) calls.push(mockExit("finished_normally", "full", "high", "high"));
    return calls.length ? calls : [mockExit("no_more_action", "skimmed", "low", "medium")];
  }

  return [];
}

async function isDeterministicFeedOnlyExitParticipant(runId: string, participantId: string) {
  const firstParticipant = await prisma.runParticipant.findFirst({
    where: { runId },
    orderBy: { id: "asc" },
    select: { id: true }
  });
  return firstParticipant?.id === participantId;
}

type DemoCommentPoolName = keyof typeof demoCommentPools;

function mockComment(poolName: DemoCommentPoolName, indexHint: number) {
  const pool: readonly string[] = demoCommentPools[poolName];
  return pick(pool, indexHint);
}

function mockCommentForIndex(indexHint: number): DemoCommentPoolName {
  return indexHint % 4 === 0 ? "resonance"
    : indexHint % 4 === 1 ? "experience"
      : indexHint % 4 === 2 ? "question"
        : "lowIntent";
}

function intentForPool(poolName: DemoCommentPoolName): CommentIntent {
  switch (poolName) {
    case "question": return "ask";
    case "doubt": return "doubt";
    case "resonance": return "agree";
    case "experience": return "share_experience";
    case "lowIntent": return "joke";
  }
}

function mockReadPost(depth: ReadDepth): ParsedToolCall {
  return { toolName: "read_post", args: { depth, focus: [] } };
}

function mockExit(
  reasonCategory: ExitReasonCategory,
  readingDepth: ExitReadingDepth,
  interestLevel: InterestTrustLevel,
  trustLevel: InterestTrustLevel
): ParsedToolCall {
  return { toolName: "exit_browsing", args: { reasonCategory, readingDepth, interestLevel, trustLevel } };
}

function mockWriteComment(poolName: DemoCommentPoolName, indexHint: number, replyToCommentId: string | null): ParsedToolCall {
  // doubt pool splits into doubt / pushback for variety
  const intent: CommentIntent = poolName === "doubt" && indexHint % 3 === 0 ? "pushback" : intentForPool(poolName);
  return {
    toolName: "write_comment",
    args: {
      content: mockComment(poolName, indexHint),
      intent,
      replyToCommentId
    }
  };
}

function depthToExitDepth(depth: ReadDepth): ExitReadingDepth {
  switch (depth) {
    case "skim": return "skimmed";
    case "partial": return "partial";
    case "full": return "full";
  }
}

function buildThought(context: RunParticipantContext, calls: ParsedToolCall[]): string {
  const toolNames = calls.map((call) => call.toolName);
  if (!context.hasOpenedPost && toolNames.includes("exit_browsing")) {
    return `标题和封面都不太相关，先划走。`;
  }
  if (toolNames.includes("open_post")) {
    return `避坑清单有点意思，点开看看。`;
  }
  if (toolNames.includes("read_post") && !toolNames.includes("write_comment") && !toolNames.includes("like_post") && !toolNames.includes("favorite_post") && !toolNames.includes("share_post")) {
    const depth = calls.find((c) => c.toolName === "read_post")?.args.depth as string | undefined;
    if (depth === "skim") return `快速扫了一眼，没啥感觉。`;
    if (depth === "partial") return `看了部分，感觉不太对劲。`;
    return `基本看完了，没有特别想互动的。`;
  }
  if (toolNames.includes("write_comment")) {
    const intent = calls.find((c) => c.toolName === "write_comment")?.args.intent as string | undefined;
    if (intent === "doubt") return `这个结论有点绝对，想追问一下。`;
    if (intent === "ask") return `正好有疑问，评论区问问。`;
    if (intent === "share_experience") return `我也有类似经验，补充一下。`;
    return `想说点什么，留条评论。`;
  }
  if (toolNames.includes("share_post")) {
    return `这个清单转给待产的朋友正合适。`;
  }
  if (toolNames.includes("like_comment")) {
    return `这条评论说得太对了。`;
  }
  if (toolNames.includes("favorite_post")) {
    return `先收藏，下次买东西对照看。`;
  }
  return `看完了，差不多该走了。`;
}

function firstCommentIdFromTranscript(context: RunParticipantContext) {
  for (const message of [...context.messages].reverse()) {
    if (message.role !== "tool") continue;
    const resultPart = message.content.find(isViewCommentsToolResult) as JsonToolResultPart | undefined;
    if (!resultPart) continue;
    const output = toolResultOutputValue(resultPart.output);
    const result = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
    const comments = Array.isArray(result.comments) ? result.comments : [];
    const first = comments[0];
    if (first && typeof first === "object" && "id" in first && typeof first.id === "string") {
      return first.id;
    }
  }
  return null;
}

type JsonToolResultPart = {
  type: "tool-result";
  toolName: string;
  output:
    | { type: "json"; value: unknown }
    | { type: "text"; value: string }
    | { type: string; value?: unknown };
};

function isViewCommentsToolResult(part: unknown): part is JsonToolResultPart {
  const record = part && typeof part === "object" ? part as Record<string, unknown> : {};
  return record.type === "tool-result" && record.toolName === "view_comments" && "output" in record;
}

function toolResultOutputValue(output: JsonToolResultPart["output"]) {
  if (output.type === "json") return output.value;
  if (output.type === "text" && typeof output.value === "string") return safeJson(output.value);
  return null;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
